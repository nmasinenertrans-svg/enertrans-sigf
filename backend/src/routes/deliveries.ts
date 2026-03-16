import { Router } from 'express'
import { z } from 'zod'
import { prisma, runWithSchemaFailover } from '../db.js'
import type { AuthenticatedRequest } from '../middleware/auth.js'

const router = Router()

const logisticsStatuses = ['AVAILABLE', 'PENDING_DELIVERY', 'DELIVERED', 'PENDING_RETURN', 'RETURNED'] as const
const deliveryTargets = new Set(['PENDING_DELIVERY', 'DELIVERED'])
const returnTargets = new Set(['PENDING_RETURN', 'RETURNED'])

const operationSchema = z.object({
  id: z.string().optional(),
  unitId: z.string().min(1),
  operationType: z.enum(['DELIVERY', 'RETURN']),
  targetLogisticsStatus: z.enum(logisticsStatuses).optional(),
  clientId: z.string().optional().nullable(),
  summary: z.string().max(160).optional().default(''),
  reason: z.string().max(1000).optional().default(''),
  effectiveAt: z.string().optional(),
})

const normalize = (value: string | undefined) => (value ?? '').trim()

const resolveTargetStatus = (
  operationType: 'DELIVERY' | 'RETURN',
  target?: (typeof logisticsStatuses)[number],
): (typeof logisticsStatuses)[number] => {
  if (target) {
    return target
  }
  return operationType === 'DELIVERY' ? 'PENDING_DELIVERY' : 'PENDING_RETURN'
}

const ensureTargetMatchesOperation = (
  operationType: 'DELIVERY' | 'RETURN',
  target: (typeof logisticsStatuses)[number],
): boolean => {
  if (operationType === 'DELIVERY') {
    return deliveryTargets.has(target)
  }
  return returnTargets.has(target)
}

router.get('/', async (_req, res) => {
  try {
    const items = await runWithSchemaFailover(() =>
      prisma.deliveryOperation.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          unit: { select: { id: true, internalCode: true, ownerCompany: true } },
          client: { select: { id: true, name: true } },
        },
      }),
    )
    return res.json(items)
  } catch (error) {
    console.error('Deliveries GET error:', error)
    return res.status(500).json({ message: 'No se pudieron cargar entregas/devoluciones.' })
  }
})

router.post('/', async (req: AuthenticatedRequest, res) => {
  const parsed = operationSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
  }

  const targetStatus = resolveTargetStatus(parsed.data.operationType, parsed.data.targetLogisticsStatus)
  if (!ensureTargetMatchesOperation(parsed.data.operationType, targetStatus)) {
    return res.status(400).json({ message: 'El estado logistico no coincide con el tipo de operacion.' })
  }

  try {
    const unit = await prisma.fleetUnit.findUnique({ where: { id: parsed.data.unitId } })
    if (!unit) {
      return res.status(404).json({ message: 'Unidad no encontrada.' })
    }

    const selectedClientId = normalize(parsed.data.clientId ?? '') || null
    const client = selectedClientId
      ? await prisma.clientAccount.findUnique({ where: { id: selectedClientId } })
      : null

    if (parsed.data.operationType === 'DELIVERY' && !client && !unit.clientId) {
      return res.status(400).json({ message: 'Debes asociar un cliente para registrar una entrega.' })
    }

    const effectiveAt = parsed.data.effectiveAt ? new Date(parsed.data.effectiveAt) : new Date()
    const safeEffectiveAt = Number.isNaN(effectiveAt.getTime()) ? new Date() : effectiveAt

    const nextClientId =
      targetStatus === 'RETURNED'
        ? null
        : client?.id ?? unit.clientId ?? null
    const nextClientName =
      targetStatus === 'RETURNED'
        ? ''
        : client?.name ?? unit.clientName ?? ''

    const actor = req.userId
      ? await prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, fullName: true } })
      : null

    const created = await prisma.$transaction(async (tx) => {
      await tx.fleetUnit.update({
        where: { id: unit.id },
        data: {
          clientId: nextClientId,
          clientName: nextClientName,
          logisticsStatus: targetStatus,
          logisticsStatusNote: normalize(parsed.data.reason) || normalize(parsed.data.summary),
          logisticsUpdatedAt: safeEffectiveAt,
        },
      })

      return tx.deliveryOperation.create({
        data: {
          unitId: unit.id,
          clientId: client?.id ?? unit.clientId ?? null,
          operationType: parsed.data.operationType,
          targetLogisticsStatus: targetStatus,
          summary: normalize(parsed.data.summary),
          reason: normalize(parsed.data.reason),
          requestedByUserId: actor?.id ?? null,
          requestedByUserName: actor?.fullName ?? '',
          effectiveAt: safeEffectiveAt,
        },
        include: {
          unit: { select: { id: true, internalCode: true, ownerCompany: true } },
          client: { select: { id: true, name: true } },
        },
      })
    })

    return res.status(201).json(created)
  } catch (error) {
    console.error('Deliveries POST error:', error)
    return res.status(500).json({ message: 'No se pudo registrar la operacion.' })
  }
})

export default router
