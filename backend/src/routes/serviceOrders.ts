import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db.js'
import { formatCode, getNextSequence } from '../utils/sequence.js'
import { getErrorCode } from '../utils/errors.js'

const router = Router()

const serviceOrderCreateSchema = z.object({
  unitId: z.string().nullable().optional(),
  externalVehicle: z.string().nullable().optional(),
  clientId: z.string().nullable().optional(),
  clientName: z.string().optional().default(''),
  reportedFault: z.string().min(1, 'La falla reportada es requerida.'),
  claimOrigin: z.enum(['EMAIL', 'PHONE_CALL', 'WHATSAPP', 'INTERNAL_INSPECTION']).optional().default('EMAIL'),
  estimatedResolutionAt: z.string().datetime().nullable().optional(),
  assignedToUserId: z.string().nullable().optional(),
  assignedToName: z.string().optional().default(''),
})

const serviceOrderUpdateSchema = z.object({
  clientName: z.string().optional(),
  reportedFault: z.string().min(1).optional(),
  claimOrigin: z.enum(['EMAIL', 'PHONE_CALL', 'WHATSAPP', 'INTERNAL_INSPECTION']).optional(),
  status: z.enum(['OPEN', 'IN_PROGRESS', 'WAITING_PARTS', 'CLOSED']).optional(),
  estimatedResolutionAt: z.string().datetime().nullable().optional(),
  assignedToUserId: z.string().nullable().optional(),
  assignedToName: z.string().optional(),
  sparePartsUsed: z.string().optional(),
  resolutionDetail: z.string().optional(),
  photoUrls: z.array(z.string()).optional(),
  closedAt: z.string().datetime().nullable().optional(),
})

import type { ServiceOrderStatus } from '@prisma/client'

const OPEN_STATUSES: ServiceOrderStatus[] = ['OPEN', 'IN_PROGRESS', 'WAITING_PARTS']

const mapOs = (os: Record<string, unknown>) => {
  const mapUser = (u: unknown) => {
    if (!u || typeof u !== 'object') return u
    const { fullName, ...rest } = u as { fullName?: string; [key: string]: unknown }
    return { ...rest, name: fullName ?? '' }
  }
  return {
    ...os,
    createdBy: mapUser(os.createdBy),
    assignedTo: mapUser(os.assignedTo),
    photoUrls: Array.isArray(os.photoUrls) ? os.photoUrls : [],
  }
}

router.get('/', async (req, res) => {
  try {
    const { unitId, clientId, status, dateFrom, dateTo } = req.query

    const where: Record<string, unknown> = {}

    if (typeof unitId === 'string' && unitId) where.unitId = unitId
    if (typeof clientId === 'string' && clientId) where.clientId = clientId
    if (typeof status === 'string' && status) {
      const statuses = status.split(',').filter(Boolean)
      where.status = statuses.length === 1 ? statuses[0] : { in: statuses }
    }
    if (typeof dateFrom === 'string' || typeof dateTo === 'string') {
      const createdAt: Record<string, unknown> = {}
      if (typeof dateFrom === 'string' && dateFrom) createdAt.gte = new Date(dateFrom)
      if (typeof dateTo === 'string' && dateTo) createdAt.lte = new Date(dateTo)
      where.createdAt = createdAt
    }

    const items = await prisma.serviceOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        unit: { select: { id: true, internalCode: true, brand: true, model: true } },
        client: { select: { id: true, name: true } },
        createdBy: { select: { id: true, fullName: true } },
        assignedTo: { select: { id: true, fullName: true } },
      },
    })

    return res.json(items.map((item) => mapOs(item as unknown as Record<string, unknown>)))
  } catch (error) {
    console.error('ServiceOrder GET list error:', error)
    return res.status(500).json({ message: 'No se pudo listar las órdenes de servicio.' })
  }
})

router.get('/metrics', async (req, res) => {
  try {
    const { unitId, clientId } = req.query

    const where: Record<string, unknown> = { status: 'CLOSED', closedAt: { not: null } }
    if (typeof unitId === 'string' && unitId) where.unitId = unitId
    if (typeof clientId === 'string' && clientId) where.clientId = clientId

    const closed = await prisma.serviceOrder.findMany({
      where,
      select: { id: true, unitId: true, clientId: true, createdAt: true, closedAt: true },
    })

    const totalClosed = closed.length
    let totalResolutionMs = 0
    for (const os of closed) {
      if (os.closedAt) {
        totalResolutionMs += os.closedAt.getTime() - os.createdAt.getTime()
      }
    }
    const avgResolutionHours = totalClosed > 0 ? totalResolutionMs / totalClosed / 3_600_000 : null

    const byUnit: Record<string, number> = {}
    const byClient: Record<string, number> = {}
    for (const os of closed) {
      if (os.unitId) byUnit[os.unitId] = (byUnit[os.unitId] ?? 0) + 1
      if (os.clientId) byClient[os.clientId] = (byClient[os.clientId] ?? 0) + 1
    }

    return res.json({ totalClosed, avgResolutionHours, reincidenceByUnit: byUnit, reincidenceByClient: byClient })
  } catch (error) {
    console.error('ServiceOrder metrics error:', error)
    return res.status(500).json({ message: 'No se pudo calcular las métricas.' })
  }
})

router.get('/:id', async (req, res) => {
  try {
    const item = await prisma.serviceOrder.findUnique({
      where: { id: req.params.id },
      include: {
        unit: { select: { id: true, internalCode: true, brand: true, model: true } },
        client: { select: { id: true, name: true } },
        createdBy: { select: { id: true, fullName: true } },
        assignedTo: { select: { id: true, fullName: true } },
      },
    })
    if (!item) return res.status(404).json({ message: 'Orden de servicio no encontrada.' })
    return res.json(mapOs(item as unknown as Record<string, unknown>))
  } catch (error) {
    console.error('ServiceOrder GET one error:', error)
    return res.status(500).json({ message: 'No se pudo obtener la orden de servicio.' })
  }
})

router.post('/', async (req, res) => {
  const userId = (req as unknown as { userId?: string }).userId
  if (!userId) return res.status(401).json({ message: 'No autenticado.' })

  const parsed = serviceOrderCreateSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos inválidos.', errors: parsed.error.flatten() })
  }

  const data = parsed.data

  // One open OS per unit at a time
  if (data.unitId) {
    const existing = await prisma.serviceOrder.findFirst({
      where: { unitId: data.unitId, status: { in: OPEN_STATUSES } },
      select: { id: true, code: true, status: true },
    })
    if (existing) {
      return res.status(409).json({
        message: `La unidad ya tiene una orden de servicio abierta (${existing.code}). Ciérrela antes de crear una nueva.`,
        conflictingId: existing.id,
      })
    }
  }

  const unit = data.unitId
    ? await prisma.fleetUnit.findUnique({ where: { id: data.unitId }, select: { internalCode: true } })
    : null
  const unitCode = unit?.internalCode ?? ''
  const code = formatCode('OS', await getNextSequence('serviceOrder'), unitCode)

  try {
    const item = await prisma.serviceOrder.create({
      data: {
        code,
        unitId: data.unitId ?? null,
        externalVehicle: data.externalVehicle ?? null,
        clientId: data.clientId ?? null,
        clientName: data.clientName ?? '',
        reportedFault: data.reportedFault,
        claimOrigin: data.claimOrigin ?? 'EMAIL',
        status: 'OPEN',
        estimatedResolutionAt: data.estimatedResolutionAt ? new Date(data.estimatedResolutionAt) : null,
        assignedToUserId: data.assignedToUserId ?? null,
        assignedToName: data.assignedToName ?? '',
        createdByUserId: userId,
      },
      include: {
        unit: { select: { id: true, internalCode: true, brand: true, model: true } },
        client: { select: { id: true, name: true } },
        createdBy: { select: { id: true, fullName: true } },
        assignedTo: { select: { id: true, fullName: true } },
      },
    })
    return res.status(201).json(mapOs(item as unknown as Record<string, unknown>))
  } catch (error: unknown) {
    if (getErrorCode(error) === 'P2002') {
      return res.status(409).json({ message: 'Código duplicado.' })
    }
    console.error('ServiceOrder POST error:', error)
    return res.status(500).json({ message: 'No se pudo crear la orden de servicio.' })
  }
})

router.patch('/:id', async (req, res) => {
  const parsed = serviceOrderUpdateSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos inválidos.', errors: parsed.error.flatten() })
  }

  const data = parsed.data

  // If closing, require resolutionDetail
  if (data.status === 'CLOSED') {
    const current = await prisma.serviceOrder.findUnique({
      where: { id: req.params.id },
      select: { resolutionDetail: true },
    })
    const finalDetail = data.resolutionDetail ?? current?.resolutionDetail ?? ''
    if (!finalDetail.trim()) {
      return res.status(400).json({ message: 'Se requiere detalle de resolución para cerrar la orden de servicio.' })
    }
  }

  try {
    const updateData: Record<string, unknown> = {}

    if (data.clientName !== undefined) updateData.clientName = data.clientName
    if (data.reportedFault !== undefined) updateData.reportedFault = data.reportedFault
    if (data.claimOrigin !== undefined) updateData.claimOrigin = data.claimOrigin
    if (data.status !== undefined) updateData.status = data.status
    if (data.estimatedResolutionAt !== undefined)
      updateData.estimatedResolutionAt = data.estimatedResolutionAt ? new Date(data.estimatedResolutionAt) : null
    if (data.assignedToUserId !== undefined) updateData.assignedToUserId = data.assignedToUserId ?? null
    if (data.assignedToName !== undefined) updateData.assignedToName = data.assignedToName
    if (data.sparePartsUsed !== undefined) updateData.sparePartsUsed = data.sparePartsUsed
    if (data.resolutionDetail !== undefined) updateData.resolutionDetail = data.resolutionDetail
    if (data.photoUrls !== undefined) updateData.photoUrls = data.photoUrls
    if (data.status === 'CLOSED' && !data.closedAt) updateData.closedAt = new Date()
    if (data.closedAt !== undefined) updateData.closedAt = data.closedAt ? new Date(data.closedAt) : null

    const item = await prisma.serviceOrder.update({
      where: { id: req.params.id },
      data: updateData,
      include: {
        unit: { select: { id: true, internalCode: true, brand: true, model: true } },
        client: { select: { id: true, name: true } },
        createdBy: { select: { id: true, fullName: true } },
        assignedTo: { select: { id: true, fullName: true } },
      },
    })
    return res.json(mapOs(item as unknown as Record<string, unknown>))
  } catch (error: unknown) {
    if (getErrorCode(error) === 'P2025') {
      return res.status(404).json({ message: 'Orden de servicio no encontrada.' })
    }
    console.error('ServiceOrder PATCH error:', error)
    return res.status(500).json({ message: 'No se pudo actualizar la orden de servicio.' })
  }
})

router.delete('/:id', async (req, res) => {
  try {
    await prisma.serviceOrder.delete({ where: { id: req.params.id } })
    return res.status(204).send()
  } catch (error: unknown) {
    if (getErrorCode(error) === 'P2025') {
      return res.status(404).json({ message: 'Orden de servicio no encontrada.' })
    }
    console.error('ServiceOrder DELETE error:', error)
    return res.status(500).json({ message: 'No se pudo eliminar la orden de servicio.' })
  }
})

export default router
