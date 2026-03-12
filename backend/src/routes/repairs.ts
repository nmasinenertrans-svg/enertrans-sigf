import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db.js'
import type { AuthenticatedRequest } from '../middleware/auth.js'
import { pushUserNotifications, resolveOperationalNotificationRecipients } from '../services/userNotifications.js'

const router = Router()

const repairSchema = z.object({
  id: z.string().uuid().optional(),
  unitId: z.string().min(1),
  sourceType: z.enum(['WORK_ORDER', 'EXTERNAL_REQUEST']).optional().default('WORK_ORDER'),
  workOrderId: z.string().optional(),
  externalRequestId: z.string().optional(),
  performedAt: z.string().datetime().optional(),
  unitKilometers: z.number().int().min(0).optional().default(0),
  currency: z.enum(['ARS', 'USD']).optional().default('ARS'),
  supplierName: z.string().min(1),
  realCost: z.number(),
  invoicedToClient: z.number(),
  margin: z.number(),
  invoiceFileName: z.string().optional(),
  invoiceFileBase64: z.string().optional(),
  invoiceFileUrl: z.string().optional(),
})

const repairUpdateSchema = repairSchema.partial()

router.get('/', async (_req, res) => {
  const items = await prisma.repairRecord.findMany({ orderBy: { createdAt: 'desc' } })
  return res.json(items)
})

router.post('/', async (req: AuthenticatedRequest, res) => {
  const parsed = repairSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
  }

  try {
    if (parsed.data.sourceType === 'WORK_ORDER' && !parsed.data.workOrderId) {
      return res.status(400).json({ message: 'Debes seleccionar una OT.' })
    }
    if (parsed.data.sourceType === 'EXTERNAL_REQUEST' && !parsed.data.externalRequestId) {
      return res.status(400).json({ message: 'Debes seleccionar una nota externa.' })
    }

    const item = await prisma.repairRecord.create({
      data: {
        ...parsed.data,
        performedAt: parsed.data.performedAt ?? new Date().toISOString(),
        unitKilometers: parsed.data.unitKilometers ?? 0,
        currency: parsed.data.currency ?? 'ARS',
      },
    })
    const [actor, workOrder, externalRequest] = await Promise.all([
      req.userId ? prisma.user.findUnique({ where: { id: req.userId }, select: { fullName: true } }) : Promise.resolve(null),
      item.workOrderId ? prisma.workOrder.findUnique({ where: { id: item.workOrderId }, select: { code: true } }) : Promise.resolve(null),
      item.externalRequestId
        ? prisma.externalRequest.findUnique({ where: { id: item.externalRequestId }, select: { code: true } })
        : Promise.resolve(null),
    ])

    const sourceLabel = workOrder?.code ?? externalRequest?.code ?? 'sin origen'
    const recipients = await resolveOperationalNotificationRecipients(req.userId)
    await pushUserNotifications(recipients, {
      title: 'Nueva reparacion cargada',
      description: `${actor?.fullName ?? 'Un usuario'} cargo una reparacion (${sourceLabel}) con proveedor ${item.supplierName}.`,
      severity: 'warning',
      target: '/repairs',
      actorUserId: req.userId,
      eventType: 'REPAIR_CREATED',
    })

    return res.status(201).json(item)
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return res.status(409).json({ message: 'Registro duplicado.' })
    }
    return res.status(500).json({ message: 'No se pudo crear la reparacion.' })
  }
})

router.patch('/:id', async (req, res) => {
  const parsed = repairUpdateSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
  }

  const item = await prisma.repairRecord.update({
    where: { id: req.params.id },
    data: {
      ...parsed.data,
      unitKilometers:
        typeof parsed.data.unitKilometers === 'number'
          ? Math.max(0, Math.trunc(parsed.data.unitKilometers))
          : parsed.data.unitKilometers,
    },
  })
  return res.json(item)
})

router.delete('/:id', async (req, res) => {
  await prisma.repairRecord.delete({ where: { id: req.params.id } })
  return res.status(204).send()
})

export default router
