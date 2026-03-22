import { Router } from 'express'
import { z } from 'zod'
import { prisma, runWithSchemaFailover } from '../db.js'
import { requirePermission } from '../middleware/permissions.js'

const router = Router()

const stageValues = ['LEAD', 'CONTACTED', 'QUALIFICATION', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'] as const
const activityTypeValues = ['CALL', 'WHATSAPP', 'EMAIL', 'MEETING', 'TASK'] as const
const activityStatusValues = ['PENDING', 'DONE'] as const
const currencyValues = ['ARS', 'USD'] as const

const stageDefaultProbability: Record<(typeof stageValues)[number], number> = {
  LEAD: 10,
  CONTACTED: 20,
  QUALIFICATION: 40,
  PROPOSAL: 60,
  NEGOTIATION: 80,
  WON: 100,
  LOST: 0,
}

const dealSchema = z.object({
  title: z.string().min(2).max(180),
  companyName: z.string().min(2).max(160),
  contactName: z.string().max(120).optional().default(''),
  contactEmail: z.string().max(180).optional().default(''),
  contactPhone: z.string().max(80).optional().default(''),
  source: z.string().max(120).optional().default(''),
  serviceLine: z.string().max(120).optional().default(''),
  amount: z.number().min(0).optional().default(0),
  currency: z.enum(currencyValues).optional().default('ARS'),
  probability: z.number().int().min(0).max(100).optional(),
  stage: z.enum(stageValues).optional().default('LEAD'),
  expectedCloseDate: z.string().optional(),
  assignedToUserId: z.string().optional().nullable(),
  notes: z.string().max(2000).optional().default(''),
})

const dealUpdateSchema = dealSchema.partial()

const stageUpdateSchema = z.object({
  stage: z.enum(stageValues),
  lostReason: z.string().max(400).optional(),
})

const activityCreateSchema = z.object({
  type: z.enum(activityTypeValues),
  summary: z.string().min(2).max(400),
  dueAt: z.string().optional(),
})

const activityUpdateSchema = z.object({
  status: z.enum(activityStatusValues).optional(),
  summary: z.string().min(2).max(400).optional(),
  dueAt: z.string().optional().nullable(),
})

const normalizeText = (value: string | undefined): string => (value ?? '').trim()

const parseOptionalDate = (value: string | null | undefined): Date | null => {
  if (!value) {
    return null
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return null
  }
  return parsed
}

const resolveProbability = (
  stage: (typeof stageValues)[number],
  explicit: number | undefined,
  fallback: number = stageDefaultProbability[stage],
) => {
  if (stage === 'WON') {
    return 100
  }
  if (stage === 'LOST') {
    return 0
  }
  if (typeof explicit === 'number' && Number.isFinite(explicit)) {
    return Math.max(0, Math.min(100, Math.round(explicit)))
  }
  return Math.max(0, Math.min(100, Math.round(fallback)))
}

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

router.get('/', requirePermission('CRM', 'view'), async (_req, res) => {
  try {
    const [deals, activities] = await runWithSchemaFailover(() =>
      Promise.all([
        prisma.crmDeal.findMany({
          orderBy: [{ updatedAt: 'desc' }],
          include: {
            assignedToUser: { select: { id: true, fullName: true, username: true } },
            createdByUser: { select: { id: true, fullName: true, username: true } },
          },
        }),
        prisma.crmActivity.findMany({
          orderBy: [{ createdAt: 'desc' }],
          include: {
            createdByUser: { select: { id: true, fullName: true, username: true } },
          },
        }),
      ]),
    )

    return res.json({ deals, activities })
  } catch (error) {
    if (isSchemaMismatchError(error)) {
      return res.json({ deals: [], activities: [] })
    }
    console.error('CRM GET error:', error)
    return res.status(500).json({ message: 'No se pudo cargar el CRM.' })
  }
})

router.post('/deals', requirePermission('CRM', 'create'), async (req: any, res) => {
  const parsed = dealSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
  }
  if (!req.userId) {
    return res.status(401).json({ message: 'No autorizado.' })
  }

  try {
    const stage = parsed.data.stage
    const expectedCloseDate = parseOptionalDate(parsed.data.expectedCloseDate)
    const created = await runWithSchemaFailover(() =>
      prisma.crmDeal.create({
        data: {
          title: normalizeText(parsed.data.title),
          companyName: normalizeText(parsed.data.companyName),
          contactName: normalizeText(parsed.data.contactName),
          contactEmail: normalizeText(parsed.data.contactEmail),
          contactPhone: normalizeText(parsed.data.contactPhone),
          source: normalizeText(parsed.data.source),
          serviceLine: normalizeText(parsed.data.serviceLine),
          amount: Number(parsed.data.amount ?? 0),
          currency: parsed.data.currency,
          stage,
          probability: resolveProbability(stage, parsed.data.probability),
          expectedCloseDate: expectedCloseDate ?? undefined,
          assignedToUserId: parsed.data.assignedToUserId ?? null,
          notes: normalizeText(parsed.data.notes),
          createdByUserId: req.userId,
          lastContactAt: new Date(),
          wonAt: stage === 'WON' ? new Date() : null,
          lostReason: stage === 'LOST' ? normalizeText(parsed.data.notes) : '',
        },
        include: {
          assignedToUser: { select: { id: true, fullName: true, username: true } },
          createdByUser: { select: { id: true, fullName: true, username: true } },
        },
      }),
    )
    return res.status(201).json(created)
  } catch (error) {
    console.error('CRM POST deal error:', error)
    return res.status(500).json({ message: 'No se pudo crear la oportunidad.' })
  }
})

router.patch('/deals/:id', requirePermission('CRM', 'edit'), async (req, res) => {
  const parsed = dealUpdateSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
  }

  try {
    const dealId = typeof req.params.id === 'string' ? req.params.id : null
    if (!dealId) {
      return res.status(400).json({ message: 'Id de oportunidad invalido.' })
    }

    const existing = await runWithSchemaFailover(() => prisma.crmDeal.findUnique({ where: { id: dealId } }))
    if (!existing) {
      return res.status(404).json({ message: 'Oportunidad no encontrada.' })
    }

    const nextStage = parsed.data.stage ?? existing.stage
    const nextProbability = resolveProbability(nextStage, parsed.data.probability, existing.probability)
    const nextExpectedCloseDate =
      parsed.data.expectedCloseDate !== undefined ? parseOptionalDate(parsed.data.expectedCloseDate) : undefined

    const updated = await runWithSchemaFailover(() =>
      prisma.crmDeal.update({
        where: { id: dealId },
        data: {
          title: parsed.data.title !== undefined ? normalizeText(parsed.data.title) : undefined,
          companyName: parsed.data.companyName !== undefined ? normalizeText(parsed.data.companyName) : undefined,
          contactName: parsed.data.contactName !== undefined ? normalizeText(parsed.data.contactName) : undefined,
          contactEmail: parsed.data.contactEmail !== undefined ? normalizeText(parsed.data.contactEmail) : undefined,
          contactPhone: parsed.data.contactPhone !== undefined ? normalizeText(parsed.data.contactPhone) : undefined,
          source: parsed.data.source !== undefined ? normalizeText(parsed.data.source) : undefined,
          serviceLine: parsed.data.serviceLine !== undefined ? normalizeText(parsed.data.serviceLine) : undefined,
          amount: parsed.data.amount !== undefined ? Number(parsed.data.amount) : undefined,
          currency: parsed.data.currency,
          stage: parsed.data.stage,
          probability: nextProbability,
          expectedCloseDate: nextExpectedCloseDate,
          assignedToUserId: parsed.data.assignedToUserId,
          notes: parsed.data.notes !== undefined ? normalizeText(parsed.data.notes) : undefined,
          wonAt: nextStage === 'WON' ? existing.wonAt ?? new Date() : null,
          lostReason: nextStage === 'LOST' ? existing.lostReason : '',
        },
        include: {
          assignedToUser: { select: { id: true, fullName: true, username: true } },
          createdByUser: { select: { id: true, fullName: true, username: true } },
        },
      }),
    )
    return res.json(updated)
  } catch (error) {
    console.error('CRM PATCH deal error:', error)
    return res.status(500).json({ message: 'No se pudo actualizar la oportunidad.' })
  }
})

router.patch('/deals/:id/stage', requirePermission('CRM', 'edit'), async (req, res) => {
  const parsed = stageUpdateSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
  }

  try {
    const dealId = typeof req.params.id === 'string' ? req.params.id : null
    if (!dealId) {
      return res.status(400).json({ message: 'Id de oportunidad invalido.' })
    }

    const existing = await runWithSchemaFailover(() => prisma.crmDeal.findUnique({ where: { id: dealId } }))
    if (!existing) {
      return res.status(404).json({ message: 'Oportunidad no encontrada.' })
    }

    const stage = parsed.data.stage
    const updated = await runWithSchemaFailover(() =>
      prisma.crmDeal.update({
        where: { id: dealId },
        data: {
          stage,
          probability: resolveProbability(stage, undefined),
          wonAt: stage === 'WON' ? existing.wonAt ?? new Date() : null,
          lostReason: stage === 'LOST' ? normalizeText(parsed.data.lostReason) : '',
          lastContactAt: new Date(),
        },
      }),
    )
    return res.json(updated)
  } catch (error) {
    console.error('CRM PATCH stage error:', error)
    return res.status(500).json({ message: 'No se pudo actualizar la etapa.' })
  }
})

router.post('/deals/:id/activities', requirePermission('CRM', 'edit'), async (req: any, res) => {
  const parsed = activityCreateSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
  }
  if (!req.userId) {
    return res.status(401).json({ message: 'No autorizado.' })
  }

  try {
    const dealId = typeof req.params.id === 'string' ? req.params.id : null
    if (!dealId) {
      return res.status(400).json({ message: 'Id de oportunidad invalido.' })
    }

    const dueAt = parseOptionalDate(parsed.data.dueAt)

    const created = await runWithSchemaFailover(() =>
      prisma.$transaction(async (tx) => {
        const deal = await tx.crmDeal.findUnique({ where: { id: dealId } })
        if (!deal) {
          const notFoundError = new Error('Deal not found')
          ;(notFoundError as any).code = 'NOT_FOUND'
          throw notFoundError
        }

        const activity = await tx.crmActivity.create({
          data: {
            dealId,
            type: parsed.data.type,
            summary: normalizeText(parsed.data.summary),
            dueAt: dueAt ?? undefined,
            createdByUserId: req.userId,
          },
          include: {
            createdByUser: { select: { id: true, fullName: true, username: true } },
          },
        })

        await tx.crmDeal.update({
          where: { id: dealId },
          data: { lastContactAt: new Date() },
        })

        return activity
      }),
    )

    return res.status(201).json(created)
  } catch (error: any) {
    if (error?.code === 'NOT_FOUND') {
      return res.status(404).json({ message: 'Oportunidad no encontrada.' })
    }
    console.error('CRM POST activity error:', error)
    return res.status(500).json({ message: 'No se pudo registrar la actividad.' })
  }
})

router.patch('/activities/:id', requirePermission('CRM', 'edit'), async (req, res) => {
  const parsed = activityUpdateSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
  }

  try {
    const activityId = typeof req.params.id === 'string' ? req.params.id : null
    if (!activityId) {
      return res.status(400).json({ message: 'Id de actividad invalido.' })
    }

    const existing = await runWithSchemaFailover(() => prisma.crmActivity.findUnique({ where: { id: activityId } }))
    if (!existing) {
      return res.status(404).json({ message: 'Actividad no encontrada.' })
    }

    const nextStatus = parsed.data.status ?? existing.status
    const dueAt =
      parsed.data.dueAt !== undefined ? parseOptionalDate(parsed.data.dueAt) : undefined

    const updated = await runWithSchemaFailover(() =>
      prisma.crmActivity.update({
        where: { id: activityId },
        data: {
          status: nextStatus,
          summary: parsed.data.summary !== undefined ? normalizeText(parsed.data.summary) : undefined,
          dueAt,
          completedAt: nextStatus === 'DONE' ? existing.completedAt ?? new Date() : null,
        },
        include: {
          createdByUser: { select: { id: true, fullName: true, username: true } },
        },
      }),
    )
    return res.json(updated)
  } catch (error) {
    console.error('CRM PATCH activity error:', error)
    return res.status(500).json({ message: 'No se pudo actualizar la actividad.' })
  }
})

router.delete('/deals/:id', requirePermission('CRM', 'delete'), async (req, res) => {
  try {
    const dealId = typeof req.params.id === 'string' ? req.params.id : null
    if (!dealId) {
      return res.status(400).json({ message: 'Id de oportunidad invalido.' })
    }
    await runWithSchemaFailover(() => prisma.crmDeal.delete({ where: { id: dealId } }))
    return res.status(204).send()
  } catch (error: any) {
    if (error?.code === 'P2025') {
      return res.status(404).json({ message: 'Oportunidad no encontrada.' })
    }
    console.error('CRM DELETE deal error:', error)
    return res.status(500).json({ message: 'No se pudo eliminar la oportunidad.' })
  }
})

export default router
