import { Router } from 'express'
import type { NextFunction, Response } from 'express'
import { z } from 'zod'
import { prisma } from '../db.js'
import { getErrorCode } from '../utils/errors.js'
import type { AuthenticatedRequest } from '../middleware/auth.js'

const router = Router()

// Modulo en construccion/prueba: solo DEV mientras se termina de validar,
// igual que contratos, checklists e importacion de reparaciones.
router.use(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!req.userId) {
    return res.status(401).json({ message: 'No autenticado.' })
  }
  const requester = await prisma.user.findUnique({ where: { id: req.userId }, select: { role: true } })
  if (!requester || requester.role !== 'DEV') {
    return res.status(403).json({ message: 'Modulo en prueba, disponible solo para DEV por ahora.' })
  }
  return next()
})

const tireCreateSchema = z.object({
  unitId: z.string().min(1),
  position: z.string().min(1),
  brand: z.string().optional().default(''),
  model: z.string().optional().default(''),
  installedAt: z.string().datetime().nullable().optional(),
  installedKm: z.number().int().min(0).optional().default(0),
  lastRotationKm: z.number().int().min(0).nullable().optional(),
  costBase: z.number().min(0).optional().default(0),
  currency: z.enum(['ARS', 'USD']).optional().default('ARS'),
  notes: z.string().optional().default(''),
  isActive: z.boolean().optional().default(true),
  removedAt: z.string().datetime().nullable().optional(),
})

const tireUpdateSchema = tireCreateSchema.partial()

const includeRelations = {
  unit: { select: { internalCode: true, brand: true, model: true, currentKilometers: true } },
} as const

router.get('/', async (_req, res) => {
  try {
    const items = await prisma.tire.findMany({
      orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
      include: includeRelations,
    })
    return res.json(items)
  } catch (error) {
    console.error('Tires GET error:', error)
    return res.status(500).json({ message: 'No se pudieron cargar las cubiertas.' })
  }
})

router.post('/', async (req: AuthenticatedRequest, res) => {
  if (!req.userId) {
    return res.status(401).json({ message: 'No autenticado.' })
  }

  const parsed = tireCreateSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
  }

  try {
    const item = await prisma.tire.create({
      data: {
        unitId: parsed.data.unitId,
        position: parsed.data.position.trim(),
        brand: parsed.data.brand.trim(),
        model: parsed.data.model.trim(),
        installedAt: parsed.data.installedAt ? new Date(parsed.data.installedAt) : null,
        installedKm: parsed.data.installedKm,
        lastRotationKm: parsed.data.lastRotationKm ?? null,
        costBase: parsed.data.costBase,
        currency: parsed.data.currency,
        notes: parsed.data.notes.trim(),
        isActive: parsed.data.isActive,
        removedAt: parsed.data.removedAt ? new Date(parsed.data.removedAt) : null,
        createdByUserId: req.userId,
      },
      include: includeRelations,
    })
    return res.status(201).json(item)
  } catch (error) {
    if (getErrorCode(error) === 'P2003') {
      return res.status(400).json({ message: 'Unidad invalida.' })
    }
    console.error('Tires POST error:', error)
    return res.status(500).json({ message: 'No se pudo crear la cubierta.' })
  }
})

router.patch('/:id', async (req, res) => {
  const parsed = tireUpdateSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
  }

  const data: Record<string, unknown> = {}
  if (parsed.data.unitId !== undefined) data.unitId = parsed.data.unitId
  if (parsed.data.position !== undefined) data.position = parsed.data.position.trim()
  if (parsed.data.brand !== undefined) data.brand = parsed.data.brand.trim()
  if (parsed.data.model !== undefined) data.model = parsed.data.model.trim()
  if (parsed.data.installedAt !== undefined) data.installedAt = parsed.data.installedAt ? new Date(parsed.data.installedAt) : null
  if (parsed.data.installedKm !== undefined) data.installedKm = parsed.data.installedKm
  if (parsed.data.lastRotationKm !== undefined) data.lastRotationKm = parsed.data.lastRotationKm
  if (parsed.data.costBase !== undefined) data.costBase = parsed.data.costBase
  if (parsed.data.currency !== undefined) data.currency = parsed.data.currency
  if (parsed.data.notes !== undefined) data.notes = parsed.data.notes.trim()
  if (parsed.data.isActive !== undefined) data.isActive = parsed.data.isActive
  if (parsed.data.removedAt !== undefined) data.removedAt = parsed.data.removedAt ? new Date(parsed.data.removedAt) : null
  // Si se registra una rotacion nueva, se resetea el aviso de desgaste para
  // que no quede colgado el aviso viejo con el km de antes de rotar.
  if (parsed.data.lastRotationKm !== undefined) data.wearAlertSentAt = null

  try {
    const item = await prisma.tire.update({
      where: { id: req.params.id },
      data,
      include: includeRelations,
    })
    return res.json(item)
  } catch (error) {
    if (getErrorCode(error) === 'P2025') {
      return res.status(404).json({ message: 'La cubierta no existe.' })
    }
    if (getErrorCode(error) === 'P2003') {
      return res.status(400).json({ message: 'Unidad invalida.' })
    }
    console.error('Tires PATCH error:', error)
    return res.status(500).json({ message: 'No se pudo actualizar la cubierta.' })
  }
})

router.delete('/:id', async (req, res) => {
  try {
    await prisma.tire.delete({ where: { id: req.params.id } })
    return res.status(204).send()
  } catch (error) {
    if (getErrorCode(error) === 'P2025') {
      return res.status(404).json({ message: 'La cubierta no existe.' })
    }
    console.error('Tires DELETE error:', error)
    return res.status(500).json({ message: 'No se pudo eliminar la cubierta.' })
  }
})

export default router
