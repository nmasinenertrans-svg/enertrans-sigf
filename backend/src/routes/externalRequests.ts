import { Router } from 'express'
import { z } from 'zod'
import { prisma, runWithSchemaFailover } from '../db.js'
import type { AuthenticatedRequest } from '../middleware/auth.js'
import { pushUserNotifications, resolveOperationalNotificationRecipients } from '../services/userNotifications.js'

const router = Router()

const CURRENCY_VALUES = ['ARS', 'USD'] as const
const ELIGIBILITY_VALUES = ['PENDING_ATTACHMENT', 'READY_FOR_REPAIR'] as const

const externalRequestPartItemSchema = z.object({
  description: z.string().min(1).max(240),
  quantity: z.number().positive(),
  unitPrice: z.number().min(0),
  lineTotal: z.number().min(0).optional(),
})

const externalRequestSchema = z.object({
  id: z.string().min(1).optional(),
  code: z.string().min(1),
  unitId: z.string().min(1),
  companyName: z.string().min(1),
  description: z.string().min(1),
  tasks: z.array(z.string().min(1)),
  currency: z.enum(CURRENCY_VALUES).optional(),
  partsItems: z.array(externalRequestPartItemSchema).optional(),
  partsTotal: z.number().min(0).optional(),
  eligibilityStatus: z.enum(ELIGIBILITY_VALUES).optional(),
  linkedRepairId: z.string().optional().nullable(),
  providerFileName: z.string().optional(),
  providerFileUrl: z.string().optional(),
  createdAt: z.string().optional(),
})

const externalRequestUpdateSchema = externalRequestSchema.partial()

type ExternalRequestInput = z.infer<typeof externalRequestSchema>
type ExternalRequestUpdateInput = z.infer<typeof externalRequestUpdateSchema>
type ExternalRequestPartItem = {
  description: string
  quantity: number
  unitPrice: number
  lineTotal: number
}

const normalizeCurrency = (value: unknown): (typeof CURRENCY_VALUES)[number] => {
  return value === 'USD' ? 'USD' : 'ARS'
}

const normalizeTasks = (tasks: string[]): string[] => {
  const next = tasks.map((item) => item.trim()).filter(Boolean)
  return next.length > 0 ? next : ['Sin detalle']
}

const normalizePartItems = (rawItems: unknown): ExternalRequestPartItem[] => {
  if (!Array.isArray(rawItems)) {
    return []
  }
  return rawItems
    .map((raw) => {
      const parsed = externalRequestPartItemSchema.safeParse(raw)
      if (!parsed.success) {
        return null
      }
      const description = parsed.data.description.trim()
      const quantity = Number(parsed.data.quantity)
      const unitPrice = Number(parsed.data.unitPrice)
      if (!description || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0) {
        return null
      }
      const lineTotal = Number((quantity * unitPrice).toFixed(2))
      return {
        description,
        quantity: Number(quantity.toFixed(2)),
        unitPrice: Number(unitPrice.toFixed(2)),
        lineTotal,
      }
    })
    .filter((item): item is ExternalRequestPartItem => Boolean(item))
}

const calculatePartsTotal = (items: ExternalRequestPartItem[]): number =>
  Number(items.reduce((total, item) => total + item.lineTotal, 0).toFixed(2))

const resolveEligibilityStatus = (providerFileUrl: string): (typeof ELIGIBILITY_VALUES)[number] =>
  providerFileUrl.trim() ? 'READY_FOR_REPAIR' : 'PENDING_ATTACHMENT'

const toCreateData = (input: ExternalRequestInput) => {
  const partsItems = normalizePartItems(input.partsItems ?? [])
  const providerFileUrl = (input.providerFileUrl ?? '').trim()

  return {
    id: input.id,
    code: input.code.trim(),
    unitId: input.unitId,
    companyName: input.companyName.trim(),
    description: input.description.trim(),
    tasks: normalizeTasks(input.tasks),
    currency: normalizeCurrency(input.currency),
    partsItems: partsItems as any,
    partsTotal: calculatePartsTotal(partsItems),
    eligibilityStatus: resolveEligibilityStatus(providerFileUrl),
    providerFileName: (input.providerFileName ?? '').trim(),
    providerFileUrl,
    createdAt: input.createdAt ? new Date(input.createdAt) : undefined,
  }
}

const toUpdateData = (input: ExternalRequestUpdateInput, existing: any) => {
  const nextTasks =
    input.tasks !== undefined
      ? normalizeTasks(input.tasks)
      : Array.isArray(existing.tasks)
        ? normalizeTasks(existing.tasks)
        : ['Sin detalle']

  const nextProviderFileUrl =
    input.providerFileUrl !== undefined ? (input.providerFileUrl ?? '').trim() : String(existing.providerFileUrl ?? '')

  const nextPartsItems =
    input.partsItems !== undefined ? normalizePartItems(input.partsItems) : normalizePartItems(existing.partsItems)

  const data: Record<string, unknown> = {
    tasks: nextTasks,
    currency: normalizeCurrency(input.currency ?? existing.currency),
    partsItems: nextPartsItems as any,
    partsTotal: calculatePartsTotal(nextPartsItems),
    eligibilityStatus: resolveEligibilityStatus(nextProviderFileUrl),
    providerFileUrl: nextProviderFileUrl,
  }

  if (input.code !== undefined) {
    data.code = input.code.trim()
  }
  if (input.unitId !== undefined) {
    data.unitId = input.unitId
  }
  if (input.companyName !== undefined) {
    data.companyName = input.companyName.trim()
  }
  if (input.description !== undefined) {
    data.description = input.description.trim()
  }
  if (input.providerFileName !== undefined) {
    data.providerFileName = (input.providerFileName ?? '').trim()
  }
  if (input.createdAt !== undefined && input.createdAt) {
    data.createdAt = new Date(input.createdAt)
  }

  return data
}

router.get('/', async (_req, res) => {
  try {
    const items = await runWithSchemaFailover(() => prisma.externalRequest.findMany({ orderBy: { createdAt: 'desc' } }))
    return res.json(items)
  } catch (error: any) {
    console.error('ExternalRequest GET error:', error)
    return res.json([])
  }
})

router.post('/', async (req: AuthenticatedRequest, res) => {
  const parsed = externalRequestSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
  }

  try {
    const data = toCreateData(parsed.data)
    const item = await runWithSchemaFailover(() => prisma.externalRequest.create({ data }))
    const [actor, unit] = await Promise.all([
      req.userId ? prisma.user.findUnique({ where: { id: req.userId }, select: { fullName: true } }) : Promise.resolve(null),
      prisma.fleetUnit.findUnique({ where: { id: item.unitId }, select: { internalCode: true } }),
    ])

    const recipients = await resolveOperationalNotificationRecipients(req.userId)
    await pushUserNotifications(recipients, {
      title: 'Nueva nota de pedido',
      description: `${actor?.fullName ?? 'Un usuario'} creo ${item.code}${unit?.internalCode ? ` para ${unit.internalCode}` : ''}.`,
      severity: 'info',
      target: '/work-orders/external-requests',
      actorUserId: req.userId,
      eventType: 'EXTERNAL_REQUEST_CREATED',
    })

    return res.status(201).json(item)
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return res.status(409).json({ message: 'Registro duplicado.' })
    }
    if (error?.code === 'P2003') {
      return res.status(409).json({ message: 'Unidad no valida.' })
    }
    return res.status(500).json({ message: 'No se pudo crear la nota de pedido.' })
  }
})

router.patch('/:id', async (req, res) => {
  const parsed = externalRequestUpdateSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
  }

  try {
    const item = await runWithSchemaFailover(async () => {
      const existing = await prisma.externalRequest.findUnique({ where: { id: req.params.id } })
      if (!existing) {
        const notFoundError = new Error('ExternalRequest not found')
        ;(notFoundError as any).code = 'NOT_FOUND'
        throw notFoundError
      }
      const data = toUpdateData(parsed.data, existing)
      return prisma.externalRequest.update({ where: { id: req.params.id }, data })
    })
    return res.json(item)
  } catch (error: any) {
    if (error?.code === 'NOT_FOUND' || error?.code === 'P2025') {
      return res.status(404).json({ message: 'La nota de pedido no existe.' })
    }
    console.error('ExternalRequest PATCH error:', error)
    return res.status(500).json({ message: 'No se pudo actualizar la nota de pedido.' })
  }
})

router.delete('/:id', async (req, res) => {
  try {
    await runWithSchemaFailover(async () => {
      const existing = await prisma.externalRequest.findUnique({
        where: { id: req.params.id },
        select: { id: true, linkedRepairId: true },
      })
      if (!existing) {
        const notFoundError = new Error('ExternalRequest not found')
        ;(notFoundError as any).code = 'NOT_FOUND'
        throw notFoundError
      }
      if (existing.linkedRepairId) {
        const linkedError = new Error('ExternalRequest linked to repair')
        ;(linkedError as any).code = 'REQUEST_LINKED'
        throw linkedError
      }
      await prisma.externalRequest.delete({ where: { id: req.params.id } })
    })
    return res.status(204).send()
  } catch (error: any) {
    if (error?.code === 'NOT_FOUND' || error?.code === 'P2025') {
      return res.status(404).json({ message: 'La nota de pedido no existe.' })
    }
    if (error?.code === 'REQUEST_LINKED') {
      return res.status(409).json({ message: 'No se puede eliminar una NDP ya vinculada a una reparacion.' })
    }
    console.error('ExternalRequest DELETE error:', error)
    return res.status(500).json({ message: 'No se pudo eliminar la nota de pedido.' })
  }
})

export default router
