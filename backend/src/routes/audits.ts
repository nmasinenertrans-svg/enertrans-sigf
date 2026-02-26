import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db.js'
import { formatCode, getNextSequence } from '../utils/sequence.js'

const router = Router()

const auditSchema = z.object({
  id: z.string().uuid().optional(),
  code: z.string().optional(),
  auditKind: z.enum(['AUDIT', 'REAUDIT']).optional(),
  unitId: z.string().min(1),
  auditorUserId: z.string().min(1),
  auditorName: z.string().min(1),
  performedAt: z.string().min(1),
  result: z.enum(['APPROVED', 'REJECTED']),
  observations: z.string().optional().default(''),
  photoUrls: z.array(z.string()).optional().default([]),
  checklist: z.record(z.string(), z.any()).optional().default({}),
  unitKilometers: z.coerce.number().int().nonnegative().optional().default(0),
  engineHours: z.coerce.number().int().nonnegative().optional().default(0),
  hydroHours: z.coerce.number().int().nonnegative().optional().default(0),
  workOrderId: z.string().uuid().optional(),
  workOrderCode: z.string().optional(),
})

const createDeviationId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `deviation-${Date.now()}-${Math.round(Math.random() * 10000)}`
}

const extractBadItems = (checklist: any): any[] => {
  const sections = Array.isArray(checklist?.sections) ? checklist.sections : []
  const badItems = sections.flatMap((section: any) => {
    if (!Array.isArray(section.items)) {
      return []
    }
    return section.items
      .filter((item: any) => item.status === 'BAD')
      .map((item: any) => ({
        id: createDeviationId(),
        section: section.title ?? 'GENERAL',
        item: item.label ?? 'Desvio',
        observation: item.observation ?? '',
        status: 'PENDING',
        resolutionNote: '',
        resolutionPhotoBase64: '',
        resolutionPhotoUrl: '',
      }))
  })

  if (badItems.length > 0) {
    return badItems
  }

  return [
    {
      id: createDeviationId(),
      section: 'GENERAL',
      item: 'Desvios detectados en auditoria',
      observation: '',
      status: 'PENDING',
      resolutionNote: '',
      resolutionPhotoBase64: '',
      resolutionPhotoUrl: '',
    },
  ]
}

const resolveAuditKind = async (unitId: string): Promise<'AUDIT' | 'REAUDIT'> => {
  const openWorkOrders = await prisma.workOrder.findFirst({
    where: { unitId, status: { in: ['OPEN', 'IN_PROGRESS'] } },
  })
  if (openWorkOrders) {
    return 'AUDIT'
  }
  const closedWorkOrders = await prisma.workOrder.findFirst({
    where: { unitId, status: 'CLOSED' },
  })
  return closedWorkOrders ? 'REAUDIT' : 'AUDIT'
}

router.get('/', async (_req, res) => {
  const items = await prisma.auditRecord.findMany({ orderBy: { createdAt: 'desc' } })
  return res.json(items)
})

router.post('/', async (req, res) => {
  const parsed = auditSchema.safeParse(req.body)
  if (!parsed.success) {
    console.error('Audit POST validation error:', parsed.error?.flatten?.() ?? parsed.error)
    return res.status(400).json({ message: 'Datos invalidos.' })
  }

  if (parsed.data.id) {
    const existing = await prisma.auditRecord.findUnique({ where: { id: parsed.data.id } })
    if (existing) {
      return res.json(existing)
    }
  }

  const auditKind = parsed.data.auditKind ?? (await resolveAuditKind(parsed.data.unitId))
  const unit = await prisma.fleetUnit.findUnique({
    where: { id: parsed.data.unitId },
    select: { internalCode: true },
  })
  const unitCode = unit?.internalCode ?? ''
  // Server must be the source of truth for audit codes.
  // Frontend/local sequence can drift (PWA/offline/cache/reset) and cause collisions.
  const code = formatCode(auditKind === 'REAUDIT' ? 'RAU' : 'AU', await getNextSequence(auditKind), unitCode)

  const data = {
    id: parsed.data.id,
    code,
    auditKind,
    unitId: parsed.data.unitId,
    auditorUserId: parsed.data.auditorUserId,
    auditorName: parsed.data.auditorName,
    performedAt: new Date(parsed.data.performedAt),
    result: parsed.data.result,
    observations: parsed.data.observations,
    photoUrls: parsed.data.photoUrls,
    checklist: parsed.data.checklist,
    unitKilometers: parsed.data.unitKilometers,
    engineHours: parsed.data.engineHours,
    hydroHours: parsed.data.hydroHours,
    workOrderId: parsed.data.workOrderId,
  }

  try {
    const item = await prisma.auditRecord.create({ data })

    await prisma.fleetUnit.update({
      where: { id: item.unitId },
      data: {
        currentKilometers: parsed.data.unitKilometers,
        currentEngineHours: parsed.data.engineHours,
        currentHydroHours: parsed.data.hydroHours,
      },
    })

    if (item.result === 'REJECTED') {
      const openWorkOrder = await prisma.workOrder.findFirst({
        where: {
          unitId: item.unitId,
          status: { in: ['OPEN', 'IN_PROGRESS'] },
        },
      })

        if (!openWorkOrder) {
          const workOrderCode =
            parsed.data.workOrderCode ?? formatCode('OT', await getNextSequence('workOrder'), unitCode)
          await prisma.workOrder.create({
            data: {
              id: parsed.data.workOrderId,
              code: workOrderCode,
              pendingReaudit: false,
              unitId: item.unitId,
              status: 'OPEN',
              taskList: extractBadItems(parsed.data.checklist),
              spareParts: [],
              laborDetail: `Desvios detectados en auditoria ${code}`,
              linkedInventorySkuList: [],
            },
          })
        }

      await prisma.fleetUnit.update({
        where: { id: item.unitId },
        data: { operationalStatus: 'OUT_OF_SERVICE' },
      })
    } else {
      if (parsed.data.workOrderId) {
        await prisma.workOrder.updateMany({
          where: { id: parsed.data.workOrderId },
          data: { pendingReaudit: false },
        })
      }
      await prisma.workOrder.updateMany({
        where: { unitId: item.unitId, pendingReaudit: true },
        data: { pendingReaudit: false },
      })
      const openWorkOrders = await prisma.workOrder.findFirst({
        where: {
          unitId: item.unitId,
          status: { in: ['OPEN', 'IN_PROGRESS'] },
        },
      })

      if (!openWorkOrders) {
        await prisma.fleetUnit.update({
          where: { id: item.unitId },
          data: { operationalStatus: 'OPERATIONAL' },
        })
      }
    }

    return res.status(201).json(item)
  } catch (error: any) {
    if (error?.code === 'P2002') {
      // Do not mask collisions by returning a record looked up by code:
      // that can make the UI show an old audit when creating a new one.
      return res.status(409).json({ message: 'Registro duplicado.' })
    }
    if (error?.code === 'P2003') {
      return res.status(400).json({ message: 'Referencia invalida. Verifica la unidad.' })
    }
    if (error?.code === 'P2025') {
      return res.status(404).json({ message: 'Unidad no encontrada.' })
    }
    console.error('Error creando auditoria:', error)
    return res.status(500).json({ message: 'No se pudo crear la auditoria.' })
  }
})

router.delete('/:id', async (req, res) => {
  await prisma.auditRecord.delete({ where: { id: req.params.id } })
  return res.status(204).send()
})

export default router
