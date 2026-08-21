import { Router } from 'express'
import type { NextFunction, Response } from 'express'
import { z } from 'zod'
import { prisma } from '../db.js'
import { getErrorCode } from '../utils/errors.js'
import type { AuthenticatedRequest } from '../middleware/auth.js'

const router = Router()

// Modulo en construccion/prueba: solo DEV mientras se termina de validar,
// igual que el importador de reparaciones.
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

const CONTRACT_STATUSES = ['ACTIVE', 'FINISHED', 'CANCELLED'] as const

const contractCreateSchema = z.object({
  code: z.string().optional().default(''),
  unitId: z.string().min(1),
  clientId: z.string().nullable().optional(),
  clientName: z.string().optional().default(''),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  monthlyValue: z.number().min(0).optional().default(0),
  currency: z.enum(['ARS', 'USD']).optional().default('ARS'),
  status: z.enum(CONTRACT_STATUSES).optional().default('ACTIVE'),
  notes: z.string().optional().default(''),
})

const contractUpdateSchema = contractCreateSchema.partial()

router.get('/', async (_req, res) => {
  try {
    const items = await prisma.rentalContract.findMany({
      orderBy: { endDate: 'asc' },
      include: {
        unit: { select: { internalCode: true, brand: true, model: true } },
        client: { select: { name: true } },
      },
    })
    return res.json(items)
  } catch (error) {
    console.error('Contracts GET error:', error)
    return res.status(500).json({ message: 'No se pudieron cargar los contratos.' })
  }
})

router.post('/', async (req: AuthenticatedRequest, res) => {
  if (!req.userId) {
    return res.status(401).json({ message: 'No autenticado.' })
  }

  const parsed = contractCreateSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
  }

  if (new Date(parsed.data.endDate) <= new Date(parsed.data.startDate)) {
    return res.status(400).json({ message: 'La fecha de fin debe ser posterior a la fecha de inicio.' })
  }

  try {
    const item = await prisma.rentalContract.create({
      data: {
        code: parsed.data.code.trim(),
        unitId: parsed.data.unitId,
        clientId: parsed.data.clientId || null,
        clientName: parsed.data.clientName.trim(),
        startDate: new Date(parsed.data.startDate),
        endDate: new Date(parsed.data.endDate),
        monthlyValue: parsed.data.monthlyValue,
        currency: parsed.data.currency,
        status: parsed.data.status,
        notes: parsed.data.notes.trim(),
        createdByUserId: req.userId,
      },
      include: {
        unit: { select: { internalCode: true, brand: true, model: true } },
        client: { select: { name: true } },
      },
    })
    return res.status(201).json(item)
  } catch (error) {
    if (getErrorCode(error) === 'P2003') {
      return res.status(400).json({ message: 'Unidad o cliente invalido.' })
    }
    console.error('Contracts POST error:', error)
    return res.status(500).json({ message: 'No se pudo crear el contrato.' })
  }
})

router.patch('/:id', async (req, res) => {
  const parsed = contractUpdateSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
  }

  const data: Record<string, unknown> = {}
  if (parsed.data.code !== undefined) data.code = parsed.data.code.trim()
  if (parsed.data.unitId !== undefined) data.unitId = parsed.data.unitId
  if (parsed.data.clientId !== undefined) data.clientId = parsed.data.clientId || null
  if (parsed.data.clientName !== undefined) data.clientName = parsed.data.clientName.trim()
  if (parsed.data.startDate !== undefined) data.startDate = new Date(parsed.data.startDate)
  if (parsed.data.endDate !== undefined) {
    data.endDate = new Date(parsed.data.endDate)
    // Si se corrio la fecha de vencimiento, vuelve a habilitar el aviso de vencimiento.
    data.expirationAlertSentAt = null
  }
  if (parsed.data.monthlyValue !== undefined) data.monthlyValue = parsed.data.monthlyValue
  if (parsed.data.currency !== undefined) data.currency = parsed.data.currency
  if (parsed.data.status !== undefined) data.status = parsed.data.status
  if (parsed.data.notes !== undefined) data.notes = parsed.data.notes.trim()

  try {
    const item = await prisma.rentalContract.update({
      where: { id: req.params.id },
      data,
      include: {
        unit: { select: { internalCode: true, brand: true, model: true } },
        client: { select: { name: true } },
      },
    })
    return res.json(item)
  } catch (error) {
    if (getErrorCode(error) === 'P2025') {
      return res.status(404).json({ message: 'El contrato no existe.' })
    }
    if (getErrorCode(error) === 'P2003') {
      return res.status(400).json({ message: 'Unidad o cliente invalido.' })
    }
    console.error('Contracts PATCH error:', error)
    return res.status(500).json({ message: 'No se pudo actualizar el contrato.' })
  }
})

router.delete('/:id', async (req, res) => {
  try {
    await prisma.rentalContract.delete({ where: { id: req.params.id } })
    return res.status(204).send()
  } catch (error) {
    if (getErrorCode(error) === 'P2025') {
      return res.status(404).json({ message: 'El contrato no existe.' })
    }
    console.error('Contracts DELETE error:', error)
    return res.status(500).json({ message: 'No se pudo eliminar el contrato.' })
  }
})

export default router
