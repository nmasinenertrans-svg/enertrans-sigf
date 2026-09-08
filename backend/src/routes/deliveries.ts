import { Router } from 'express'
import { z } from 'zod'
import { prisma, runWithSchemaFailover } from '../db.js'
import type { AuthenticatedRequest } from '../middleware/auth.js'

const router = Router()

const logisticsStatuses = ['AVAILABLE', 'PENDING_DELIVERY', 'DELIVERED', 'PENDING_RETURN', 'RETURNED'] as const
const deliveryTargets = new Set(['PENDING_DELIVERY', 'DELIVERED'])
const returnTargets = new Set(['PENDING_RETURN', 'RETURNED'])
const finalStatuses = new Set(['DELIVERED', 'RETURNED'])

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

const remitoAttachmentSchema = z.object({
  remitoFileName: z.string().trim().min(1).max(240),
  remitoFileUrl: z.string().trim().min(1).max(2000),
})

const normalize = (value: string | undefined) => (value ?? '').trim()

const isSchemaMismatchError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') {
    return false
  }
  const maybeError = error as { code?: string; message?: string }
  if (maybeError.code === 'P2021' || maybeError.code === 'P2022') {
    return true
  }
  const message = String(maybeError.message ?? '').toLowerCase()
  return message.includes('does not exist in the current database')
}

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

const allowedTransitions: Record<
  'DELIVERY' | 'RETURN',
  Record<'PENDING_DELIVERY' | 'DELIVERED' | 'PENDING_RETURN' | 'RETURNED', Set<(typeof logisticsStatuses)[number]>>
> = {
  DELIVERY: {
    PENDING_DELIVERY: new Set(['AVAILABLE', 'RETURNED', 'PENDING_DELIVERY']),
    DELIVERED: new Set(['AVAILABLE', 'RETURNED', 'PENDING_DELIVERY', 'DELIVERED']),
    PENDING_RETURN: new Set(),
    RETURNED: new Set(),
  },
  RETURN: {
    PENDING_DELIVERY: new Set(),
    DELIVERED: new Set(),
    PENDING_RETURN: new Set(['DELIVERED', 'PENDING_RETURN']),
    RETURNED: new Set(['DELIVERED', 'PENDING_RETURN', 'RETURNED']),
  },
}

const validateWorkflowTransition = (
  currentStatus: (typeof logisticsStatuses)[number] | undefined,
  operationType: 'DELIVERY' | 'RETURN',
  targetStatus: (typeof logisticsStatuses)[number],
): string | null => {
  const sourceStatus = currentStatus ?? 'AVAILABLE'
  const sourceLabelMap: Record<(typeof logisticsStatuses)[number], string> = {
    AVAILABLE: 'Disponible',
    PENDING_DELIVERY: 'Pendiente de entrega',
    DELIVERED: 'Entregado',
    PENDING_RETURN: 'Pendiente de devolucion',
    RETURNED: 'Devuelto',
  }

  if (!ensureTargetMatchesOperation(operationType, targetStatus)) {
    return 'El estado logistico no coincide con el tipo de operacion.'
  }

  const operationTransitions = allowedTransitions[operationType]
  const statusTransitions =
    operationType === 'DELIVERY'
      ? operationTransitions[targetStatus as 'PENDING_DELIVERY' | 'DELIVERED']
      : operationTransitions[targetStatus as 'PENDING_RETURN' | 'RETURNED']

  if (!statusTransitions.has(sourceStatus)) {
    return `Flujo invalido: no se puede registrar ${operationType === 'DELIVERY' ? 'entrega' : 'devolucion'} desde ${sourceLabelMap[sourceStatus]}.`
  }

  return null
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
    if (isSchemaMismatchError(error)) {
      return res.json([])
    }
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
    const unit = await runWithSchemaFailover(() => prisma.fleetUnit.findUnique({ where: { id: parsed.data.unitId } }))
    if (!unit) {
      return res.status(404).json({ message: 'Unidad no encontrada.' })
    }

    const transitionError = validateWorkflowTransition(unit.logisticsStatus, parsed.data.operationType, targetStatus)
    if (transitionError) {
      return res.status(400).json({ message: transitionError })
    }

    const selectedClientId = normalize(parsed.data.clientId ?? '') || null
    const selectedClient =
      selectedClientId && parsed.data.operationType === 'DELIVERY'
        ? await runWithSchemaFailover(() => prisma.clientAccount.findUnique({ where: { id: selectedClientId } }))
        : null

    if (selectedClientId && parsed.data.operationType === 'DELIVERY' && !selectedClient) {
      return res.status(400).json({ message: 'El cliente seleccionado no existe.' })
    }

    const effectiveAt = parsed.data.effectiveAt ? new Date(parsed.data.effectiveAt) : new Date()
    const safeEffectiveAt = Number.isNaN(effectiveAt.getTime()) ? new Date() : effectiveAt

    const actor = req.userId
      ? await runWithSchemaFailover(() =>
          prisma.user.findUnique({ where: { id: req.userId }, select: { id: true, fullName: true } }),
        )
      : null

    const baseClientId = selectedClient?.id ?? unit.clientId ?? null
    const baseClientName = selectedClient?.name ?? unit.clientName ?? ''

    if (parsed.data.operationType === 'DELIVERY' && targetStatus === 'DELIVERED' && !baseClientId && !baseClientName) {
      return res.status(400).json({ message: 'Para marcar como entregado, debes indicar un cliente destino.' })
    }

    const nextClientId =
      parsed.data.operationType === 'RETURN' && targetStatus === 'RETURNED'
        ? null
        : parsed.data.operationType === 'RETURN'
          ? unit.clientId ?? null
          : baseClientId

    const nextClientName =
      parsed.data.operationType === 'RETURN' && targetStatus === 'RETURNED'
        ? ''
        : parsed.data.operationType === 'RETURN'
          ? unit.clientName ?? ''
          : baseClientName

    const operationClientId = parsed.data.operationType === 'RETURN' ? unit.clientId ?? null : nextClientId

    const created = await runWithSchemaFailover(() =>
      prisma.$transaction(async (tx) => {
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
            clientId: operationClientId,
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
      }),
    )

    return res.status(201).json(created)
  } catch (error) {
    console.error('Deliveries POST error:', error)
    return res.status(500).json({ message: 'No se pudo registrar la operacion.' })
  }
})

router.patch('/:id/remito', async (req: AuthenticatedRequest, res) => {
  const rawId = req.params.id
  const operationId = Array.isArray(rawId) ? rawId[0] : rawId
  if (!operationId) {
    return res.status(400).json({ message: 'Operacion invalida.' })
  }

  const parsed = remitoAttachmentSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Adjunto invalido.' })
  }

  try {
    const existing = await runWithSchemaFailover(() =>
      prisma.deliveryOperation.findUnique({ where: { id: operationId } }),
    )

    if (!existing) {
      return res.status(404).json({ message: 'Operacion no encontrada.' })
    }

    if (!finalStatuses.has(existing.targetLogisticsStatus)) {
      return res.status(400).json({
        message: 'Solo se puede adjuntar remito cuando la operacion este en Entregado o Devuelto.',
      })
    }

    const actor = req.userId
      ? await runWithSchemaFailover(() => prisma.user.findUnique({ where: { id: req.userId }, select: { fullName: true } }))
      : null

    const updated = await runWithSchemaFailover(() =>
      prisma.deliveryOperation.update({
        where: { id: operationId },
        data: {
          remitoFileName: parsed.data.remitoFileName,
          remitoFileUrl: parsed.data.remitoFileUrl,
          remitoAttachedAt: new Date(),
          remitoAttachedByUserName: actor?.fullName ?? '',
        },
        include: {
          unit: { select: { id: true, internalCode: true, ownerCompany: true } },
          client: { select: { id: true, name: true } },
        },
      }),
    )

    return res.json(updated)
  } catch (error) {
    console.error('Deliveries PATCH remito error:', error)
    return res.status(500).json({ message: 'No se pudo adjuntar el remito.' })
  }
})

export default router
