import { Router } from 'express'
import type { NextFunction, Response } from 'express'
import { z } from 'zod'
import { prisma } from '../db.js'
import { getErrorCode } from '../utils/errors.js'
import type { AuthenticatedRequest } from '../middleware/auth.js'

const router = Router()

// Modulo en construccion/prueba: solo DEV mientras se termina de validar,
// igual que contratos e importacion de reparaciones.
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

const CHECKLIST_TYPES = ['DELIVERY', 'RETURN'] as const

const checklistItemSchema = z.object({
  status: z.enum(['OK', 'REGULAR', 'MALO']),
  notes: z.string().optional().default(''),
})

const checklistSchema = z.object({
  documentacion: checklistItemSchema,
  luces: checklistItemSchema,
  cubiertas: checklistItemSchema,
  frenos: checklistItemSchema,
  cabina: checklistItemSchema,
  carroceria: checklistItemSchema,
  accesorios: checklistItemSchema,
  kitSeguridad: checklistItemSchema,
})

const handoverCreateSchema = z.object({
  code: z.string().optional().default(''),
  type: z.enum(CHECKLIST_TYPES),
  unitId: z.string().min(1),
  clientId: z.string().nullable().optional(),
  clientName: z.string().optional().default(''),
  contractId: z.string().nullable().optional(),
  responsibleName: z.string().optional().default(''),
  performedAt: z.string().datetime(),
  unitKilometers: z.number().int().min(0).optional().default(0),
  engineHours: z.number().int().min(0).optional().default(0),
  fuelLevelPct: z.number().int().min(0).max(100).optional().default(0),
  checklist: checklistSchema,
  damagesFound: z.string().optional().default(''),
  chargeToClientUsd: z.number().min(0).optional().default(0),
  photoUrls: z.array(z.string()).optional().default([]),
  signedActUrl: z.string().optional().default(''),
  observations: z.string().optional().default(''),
})

const handoverUpdateSchema = handoverCreateSchema.partial()

const includeRelations = {
  unit: { select: { internalCode: true, brand: true, model: true } },
  client: { select: { name: true } },
} as const

router.get('/', async (_req, res) => {
  try {
    const items = await prisma.handoverChecklist.findMany({
      orderBy: { performedAt: 'desc' },
      include: includeRelations,
    })
    return res.json(items)
  } catch (error) {
    console.error('HandoverChecklists GET error:', error)
    return res.status(500).json({ message: 'No se pudieron cargar los checklists.' })
  }
})

router.post('/', async (req: AuthenticatedRequest, res) => {
  if (!req.userId) {
    return res.status(401).json({ message: 'No autenticado.' })
  }

  const parsed = handoverCreateSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
  }

  try {
    const item = await prisma.handoverChecklist.create({
      data: {
        code: parsed.data.code.trim(),
        type: parsed.data.type,
        unitId: parsed.data.unitId,
        clientId: parsed.data.clientId || null,
        clientName: parsed.data.clientName.trim(),
        contractId: parsed.data.contractId || null,
        responsibleName: parsed.data.responsibleName.trim(),
        performedAt: new Date(parsed.data.performedAt),
        unitKilometers: parsed.data.unitKilometers,
        engineHours: parsed.data.engineHours,
        fuelLevelPct: parsed.data.fuelLevelPct,
        checklist: parsed.data.checklist,
        damagesFound: parsed.data.damagesFound.trim(),
        chargeToClientUsd: parsed.data.chargeToClientUsd,
        photoUrls: parsed.data.photoUrls,
        signedActUrl: parsed.data.signedActUrl,
        observations: parsed.data.observations.trim(),
        createdByUserId: req.userId,
      },
      include: includeRelations,
    })
    return res.status(201).json(item)
  } catch (error) {
    if (getErrorCode(error) === 'P2003') {
      return res.status(400).json({ message: 'Unidad, cliente o contrato invalido.' })
    }
    console.error('HandoverChecklists POST error:', error)
    return res.status(500).json({ message: 'No se pudo crear el checklist.' })
  }
})

router.patch('/:id', async (req, res) => {
  const parsed = handoverUpdateSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
  }

  const data: Record<string, unknown> = {}
  if (parsed.data.code !== undefined) data.code = parsed.data.code.trim()
  if (parsed.data.type !== undefined) data.type = parsed.data.type
  if (parsed.data.unitId !== undefined) data.unitId = parsed.data.unitId
  if (parsed.data.clientId !== undefined) data.clientId = parsed.data.clientId || null
  if (parsed.data.clientName !== undefined) data.clientName = parsed.data.clientName.trim()
  if (parsed.data.contractId !== undefined) data.contractId = parsed.data.contractId || null
  if (parsed.data.responsibleName !== undefined) data.responsibleName = parsed.data.responsibleName.trim()
  if (parsed.data.performedAt !== undefined) data.performedAt = new Date(parsed.data.performedAt)
  if (parsed.data.unitKilometers !== undefined) data.unitKilometers = parsed.data.unitKilometers
  if (parsed.data.engineHours !== undefined) data.engineHours = parsed.data.engineHours
  if (parsed.data.fuelLevelPct !== undefined) data.fuelLevelPct = parsed.data.fuelLevelPct
  if (parsed.data.checklist !== undefined) data.checklist = parsed.data.checklist
  if (parsed.data.damagesFound !== undefined) data.damagesFound = parsed.data.damagesFound.trim()
  if (parsed.data.chargeToClientUsd !== undefined) data.chargeToClientUsd = parsed.data.chargeToClientUsd
  if (parsed.data.photoUrls !== undefined) data.photoUrls = parsed.data.photoUrls
  if (parsed.data.signedActUrl !== undefined) data.signedActUrl = parsed.data.signedActUrl
  if (parsed.data.observations !== undefined) data.observations = parsed.data.observations.trim()

  try {
    const item = await prisma.handoverChecklist.update({
      where: { id: req.params.id },
      data,
      include: includeRelations,
    })
    return res.json(item)
  } catch (error) {
    if (getErrorCode(error) === 'P2025') {
      return res.status(404).json({ message: 'El checklist no existe.' })
    }
    if (getErrorCode(error) === 'P2003') {
      return res.status(400).json({ message: 'Unidad, cliente o contrato invalido.' })
    }
    console.error('HandoverChecklists PATCH error:', error)
    return res.status(500).json({ message: 'No se pudo actualizar el checklist.' })
  }
})

router.delete('/:id', async (req, res) => {
  try {
    await prisma.handoverChecklist.delete({ where: { id: req.params.id } })
    return res.status(204).send()
  } catch (error) {
    if (getErrorCode(error) === 'P2025') {
      return res.status(404).json({ message: 'El checklist no existe.' })
    }
    console.error('HandoverChecklists DELETE error:', error)
    return res.status(500).json({ message: 'No se pudo eliminar el checklist.' })
  }
})

export default router
