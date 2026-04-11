import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db.js'
import { formatCode, getNextSequence } from '../utils/sequence.js'
import { getErrorCode } from '../utils/errors.js'

const router = Router()
const WORK_ORDER_DUPLICATE_WINDOW_MS = 15 * 60 * 1000

const isManualAuditModeEnabled = async (): Promise<boolean> => {
  const settings = await prisma.appSettings.findUnique({ where: { id: 'app' } })
  const featureFlags =
    settings?.featureFlags && typeof settings.featureFlags === 'object' && !Array.isArray(settings.featureFlags)
      ? (settings.featureFlags as Record<string, unknown>)
      : {}
  return featureFlags.manualAuditMode === true
}

const workOrderSchema = z.object({
  id: z.string().uuid().optional(),
  code: z.string().optional(),
  pendingReaudit: z.boolean().optional().default(false),
  unitId: z.string().min(1),
  status: z.enum(['OPEN', 'IN_PROGRESS', 'CLOSED']).optional().default('OPEN'),
  taskList: z.array(z.any()).optional().default([]),
  spareParts: z.array(z.string()).optional().default([]),
  laborDetail: z.string().optional().default(''),
  linkedInventorySkuList: z.array(z.string()).optional().default([]),
})

const workOrderUpdateSchema = workOrderSchema.partial()

const normalizeText = (value: string | null | undefined): string => (value ?? '').trim().replace(/\s+/g, ' ')

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
  return `{${entries.map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`).join(',')}}`
}

router.get('/', async (_req, res) => {
  try {
    const items = await prisma.workOrder.findMany({ orderBy: { createdAt: 'desc' } })
    return res.json(items)
  } catch (error) {
    console.error('WorkOrder GET error:', error)
    return res.status(500).json({ message: 'No se pudo listar las OT.' })
  }
})

router.post('/', async (req, res) => {
  const parsed = workOrderSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
  }

  const unit = await prisma.fleetUnit.findUnique({
    where: { id: parsed.data.unitId },
    select: { internalCode: true },
  })
  const unitCode = unit?.internalCode ?? ''
  const duplicateFrom = new Date(Date.now() - WORK_ORDER_DUPLICATE_WINDOW_MS)

  const duplicateCandidates = await prisma.workOrder.findMany({
    where: {
      unitId: parsed.data.unitId,
      createdAt: { gte: duplicateFrom },
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  })

  const duplicate = duplicateCandidates.find(
    (candidate) =>
      candidate.pendingReaudit === parsed.data.pendingReaudit &&
      normalizeText(candidate.laborDetail) === normalizeText(parsed.data.laborDetail) &&
      stableStringify(candidate.taskList) === stableStringify(parsed.data.taskList) &&
      stableStringify(candidate.spareParts) === stableStringify(parsed.data.spareParts) &&
      stableStringify(candidate.linkedInventorySkuList) === stableStringify(parsed.data.linkedInventorySkuList),
  )

  if (duplicate) {
    return res.status(200).json(duplicate)
  }

  const code = parsed.data.code ?? formatCode('OT', await getNextSequence('workOrder'), unitCode)

  try {
    const item = await prisma.workOrder.create({
      data: {
        ...parsed.data,
        status: 'OPEN',
        code,
      },
    })
    return res.status(201).json(item)
  } catch (error: unknown) {
    if (getErrorCode(error) === 'P2002') {
      return res.status(409).json({ message: 'Registro duplicado.' })
    }
    return res.status(500).json({ message: 'No se pudo crear la OT.' })
  }
})

router.patch('/:id', async (req, res) => {
  const parsed = workOrderUpdateSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
  }

  const manualAuditMode = await isManualAuditModeEnabled()
  const pendingReaudit = manualAuditMode
    ? false
    : parsed.data.status === 'CLOSED'
      ? true
      : parsed.data.pendingReaudit

  try {
    const item = await prisma.workOrder.update({
      where: { id: req.params.id },
      data: {
        ...parsed.data,
        pendingReaudit,
      },
    })

    return res.json(item)
  } catch (error: unknown) {
    if (getErrorCode(error) === 'P2025') {
      return res.status(404).json({ message: 'Orden de trabajo no encontrada.' })
    }
    console.error('WorkOrder PATCH error:', error)
    return res.status(500).json({ message: 'No se pudo actualizar la OT.' })
  }
})

router.delete('/:id', async (req, res) => {
  await prisma.workOrder.delete({ where: { id: req.params.id } })
  return res.status(204).send()
})

export default router
