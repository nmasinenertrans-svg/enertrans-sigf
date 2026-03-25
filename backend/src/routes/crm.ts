import { Router } from 'express'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma, runWithSchemaFailover } from '../db.js'
import { requirePermission } from '../middleware/permissions.js'
import { runCrmAutomations } from '../services/crmAutomations.js'

const router = Router()

const stageValues = ['LEAD', 'CONTACTED', 'QUALIFICATION', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'] as const
const dealKindValues = ['TENDER', 'CONTRACT'] as const
const activityTypeValues = ['CALL', 'WHATSAPP', 'EMAIL', 'MEETING', 'TASK'] as const
const activityStatusValues = ['PENDING', 'DONE'] as const
const dealUnitStatusValues = ['EN_CONCURSO', 'ADJUDICADA', 'PERDIDA', 'LIBERADA'] as const
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
  dealKind: z.enum(dealKindValues).optional().default('TENDER'),
  referenceCode: z.string().max(80).optional().default(''),
  isHistorical: z.boolean().optional().default(false),
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
  lostReason: z.string().max(400).optional().default(''),
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

const dealUnitCreateSchema = z.object({
  unitId: z.string().min(1),
  status: z.enum(dealUnitStatusValues).optional().default('EN_CONCURSO'),
  notes: z.string().max(500).optional().default(''),
})

const dealUnitUpdateSchema = z.object({
  status: z.enum(dealUnitStatusValues),
  notes: z.string().max(500).optional().default(''),
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

const blockingLinkStatuses = ['EN_CONCURSO', 'ADJUDICADA'] as const

const findBlockingUnitLink = async (unitId: string, dealId: string) =>
  runWithSchemaFailover(() =>
    prisma.crmDealUnit.findFirst({
      where: {
        unitId,
        dealId: { not: dealId },
        status: { in: blockingLinkStatuses as any },
      },
      include: {
        deal: {
          select: { id: true, title: true, companyName: true, dealKind: true, stage: true },
        },
      },
    }),
  )

const dealInclude: Prisma.CrmDealInclude = {
  assignedToUser: { select: { id: true, fullName: true, username: true } },
  createdByUser: { select: { id: true, fullName: true, username: true } },
  convertedClient: { select: { id: true, name: true } },
  unitLinks: {
    orderBy: [{ createdAt: 'desc' }],
    include: {
      unit: { select: { id: true, internalCode: true, ownerCompany: true, clientName: true } },
    },
  },
}

router.get('/', requirePermission('CRM', 'view'), async (_req, res) => {
  try {
    const [deals, activities] = await runWithSchemaFailover(() =>
      Promise.all([
        prisma.crmDeal.findMany({
          orderBy: [{ updatedAt: 'desc' }],
          include: dealInclude,
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

router.post('/automations/run', requirePermission('CRM', 'edit'), async (_req, res) => {
  try {
    const result = await runCrmAutomations('manual')
    return res.json(result)
  } catch (error) {
    console.error('CRM automations run error:', error)
    return res.status(500).json({ message: 'No se pudo ejecutar automatizaciones CRM.' })
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
          dealKind: parsed.data.dealKind,
          referenceCode: normalizeText(parsed.data.referenceCode),
          isHistorical: parsed.data.isHistorical,
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
          lostReason: stage === 'LOST' ? normalizeText(parsed.data.lostReason || parsed.data.notes) : '',
        },
        include: dealInclude,
      }),
    )
    return res.status(201).json(created)
  } catch (error) {
    console.error('CRM POST deal error:', error)
    return res.status(500).json({ message: 'No se pudo crear la oportunidad.' })
  }
})

router.patch('/deals/:id', requirePermission('CRM', 'edit'), async (req: any, res) => {
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

    const nextLostReason =
      nextStage === 'LOST'
        ? parsed.data.lostReason !== undefined
          ? normalizeText(parsed.data.lostReason)
          : parsed.data.stage !== undefined && parsed.data.stage !== existing.stage
            ? normalizeText(parsed.data.notes ?? existing.notes)
            : existing.lostReason
        : ''

    const updated = await runWithSchemaFailover(() =>
      prisma.$transaction(async (tx) => {
        const deal = await tx.crmDeal.update({
          where: { id: dealId },
          data: {
            title: parsed.data.title !== undefined ? normalizeText(parsed.data.title) : undefined,
            companyName: parsed.data.companyName !== undefined ? normalizeText(parsed.data.companyName) : undefined,
            dealKind: parsed.data.dealKind,
            referenceCode: parsed.data.referenceCode !== undefined ? normalizeText(parsed.data.referenceCode) : undefined,
            isHistorical: parsed.data.isHistorical,
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
            lostReason: nextLostReason,
            lastContactAt: new Date(),
          },
          include: dealInclude,
        })

        if (parsed.data.stage !== undefined && parsed.data.stage !== existing.stage) {
          await tx.crmActivity.create({
            data: {
              dealId,
              type: 'TASK',
              status: 'DONE',
              summary: `Etapa actualizada a ${parsed.data.stage}`,
              completedAt: new Date(),
              createdByUserId: req.userId ?? existing.createdByUserId,
            },
          })
        }

        return deal
      }),
    )
    return res.json(updated)
  } catch (error) {
    console.error('CRM PATCH deal error:', error)
    return res.status(500).json({ message: 'No se pudo actualizar la oportunidad.' })
  }
})

router.patch('/deals/:id/stage', requirePermission('CRM', 'edit'), async (req: any, res) => {
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
      prisma.$transaction(async (tx) => {
        const deal = await tx.crmDeal.update({
          where: { id: dealId },
          data: {
            stage,
            probability: resolveProbability(stage, undefined),
            wonAt: stage === 'WON' ? existing.wonAt ?? new Date() : null,
            lostReason: stage === 'LOST' ? normalizeText(parsed.data.lostReason) : '',
            lastContactAt: new Date(),
          },
          include: dealInclude,
        })

        await tx.crmActivity.create({
          data: {
            dealId,
            type: 'TASK',
            status: 'DONE',
            summary: `Etapa actualizada a ${stage}`,
            completedAt: new Date(),
            createdByUserId: req.userId ?? deal.createdByUserId,
          },
        })

        return deal
      }),
    )
    return res.json(updated)
  } catch (error) {
    console.error('CRM PATCH stage error:', error)
    return res.status(500).json({ message: 'No se pudo actualizar la etapa.' })
  }
})

router.post('/deals/:id/convert-client', requirePermission('CRM', 'edit'), async (_req: any, res) => {
  try {
    const dealId = typeof _req.params.id === 'string' ? _req.params.id : null
    if (!dealId) {
      return res.status(400).json({ message: 'Id de oportunidad invalido.' })
    }

    const result = await runWithSchemaFailover(() =>
      prisma.$transaction(async (tx) => {
        const deal = await tx.crmDeal.findUnique({ where: { id: dealId } })
        if (!deal) {
          const notFoundError = new Error('Deal not found')
          ;(notFoundError as any).code = 'NOT_FOUND'
          throw notFoundError
        }

        const companyName = normalizeText(deal.companyName)
        if (!companyName) {
          const invalidError = new Error('Deal company required')
          ;(invalidError as any).code = 'DEAL_COMPANY_REQUIRED'
          throw invalidError
        }

        let client = await tx.clientAccount.findFirst({
          where: {
            name: {
              equals: companyName,
              mode: 'insensitive',
            },
          },
        })

        const wasCreated = !client
        if (!client) {
          client = await tx.clientAccount.create({
            data: {
              name: companyName,
              legalName: companyName,
              contactName: normalizeText(deal.contactName),
              contactEmail: normalizeText(deal.contactEmail),
              contactPhone: normalizeText(deal.contactPhone),
              notes: `Alta automatica desde CRM (${deal.title}).`,
              isActive: true,
            },
          })
        }

        const updatedDeal = await tx.crmDeal.update({
          where: { id: dealId },
          data: {
            stage: 'WON',
            probability: 100,
            wonAt: deal.wonAt ?? new Date(),
            convertedClientId: client.id,
            lastContactAt: new Date(),
          },
          include: dealInclude,
        })

        await tx.crmActivity.create({
          data: {
            dealId,
            type: 'TASK',
            status: 'DONE',
            summary: wasCreated
              ? `Oportunidad convertida a cliente (${client.name}).`
              : `Oportunidad vinculada a cliente existente (${client.name}).`,
            completedAt: new Date(),
            createdByUserId: _req.userId ?? updatedDeal.createdByUserId,
          },
        })

        return { deal: updatedDeal, client, createdClient: wasCreated }
      }),
    )

    return res.json(result)
  } catch (error: any) {
    if (error?.code === 'NOT_FOUND') {
      return res.status(404).json({ message: 'Oportunidad no encontrada.' })
    }
    if (error?.code === 'DEAL_COMPANY_REQUIRED') {
      return res.status(400).json({ message: 'La oportunidad no tiene empresa valida para convertir.' })
    }
    console.error('CRM convert client error:', error)
    return res.status(500).json({ message: 'No se pudo convertir la oportunidad en cliente.' })
  }
})

router.get('/deals/:id/units/search', requirePermission('CRM', 'view'), async (req, res) => {
  try {
    const dealId = typeof req.params.id === 'string' ? req.params.id : null
    if (!dealId) {
      return res.status(400).json({ message: 'Id de oportunidad invalido.' })
    }
    const query = String(req.query.q ?? '').trim()
    const dealExists = await runWithSchemaFailover(() => prisma.crmDeal.findUnique({ where: { id: dealId }, select: { id: true } }))
    if (!dealExists) {
      return res.status(404).json({ message: 'Oportunidad no encontrada.' })
    }

    const units = await runWithSchemaFailover(() =>
      prisma.fleetUnit.findMany({
        where: query
          ? {
              OR: [
                { internalCode: { contains: query, mode: 'insensitive' } },
                { ownerCompany: { contains: query, mode: 'insensitive' } },
                { clientName: { contains: query, mode: 'insensitive' } },
              ],
            }
          : undefined,
        select: {
          id: true,
          internalCode: true,
          ownerCompany: true,
          clientName: true,
          operationalStatus: true,
          logisticsStatus: true,
        },
        orderBy: [{ internalCode: 'asc' }],
        take: 40,
      }),
    )

    const unitIds = units.map((unit) => unit.id)
    const blockingLinks = unitIds.length
      ? await runWithSchemaFailover(() =>
          prisma.crmDealUnit.findMany({
            where: {
              unitId: { in: unitIds },
              dealId: { not: dealId },
              status: { in: blockingLinkStatuses as any },
            },
            include: {
              deal: { select: { id: true, title: true, companyName: true, dealKind: true, stage: true } },
            },
            orderBy: [{ createdAt: 'desc' }],
          }),
        )
      : []

    const blockedByUnitId = new Map<string, (typeof blockingLinks)[number]>()
    blockingLinks.forEach((link) => {
      if (!blockedByUnitId.has(link.unitId)) {
        blockedByUnitId.set(link.unitId, link)
      }
    })

    const linkedInDeal = unitIds.length
      ? await runWithSchemaFailover(() =>
          prisma.crmDealUnit.findMany({
            where: { dealId, unitId: { in: unitIds } },
            select: { unitId: true, status: true },
          }),
        )
      : []
    const linkedMap = new Map(linkedInDeal.map((item) => [item.unitId, item.status]))

    return res.json(
      units.map((unit) => ({
        ...unit,
        linkedStatusInCurrentDeal: linkedMap.get(unit.id) ?? null,
        blockedBy:
          blockedByUnitId.get(unit.id)
            ? {
                dealId: blockedByUnitId.get(unit.id)?.deal.id,
                dealTitle: blockedByUnitId.get(unit.id)?.deal.title,
                dealKind: blockedByUnitId.get(unit.id)?.deal.dealKind,
                companyName: blockedByUnitId.get(unit.id)?.deal.companyName,
                stage: blockedByUnitId.get(unit.id)?.deal.stage,
                status: blockedByUnitId.get(unit.id)?.status,
              }
            : null,
      })),
    )
  } catch (error) {
    console.error('CRM units search error:', error)
    return res.status(500).json({ message: 'No se pudieron buscar unidades para esta oportunidad.' })
  }
})

router.post('/deals/:id/units', requirePermission('CRM', 'edit'), async (req: any, res) => {
  const parsed = dealUnitCreateSchema.safeParse(req.body)
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

    const [deal, unit] = await runWithSchemaFailover(() =>
      Promise.all([
        prisma.crmDeal.findUnique({ where: { id: dealId }, select: { id: true, title: true } }),
        prisma.fleetUnit.findUnique({
          where: { id: parsed.data.unitId },
          select: { id: true, internalCode: true, ownerCompany: true, clientName: true },
        }),
      ]),
    )

    if (!deal) {
      return res.status(404).json({ message: 'Oportunidad no encontrada.' })
    }
    if (!unit) {
      return res.status(404).json({ message: 'Unidad no encontrada.' })
    }

    const existingInDeal = await runWithSchemaFailover(() =>
      prisma.crmDealUnit.findUnique({
        where: { dealId_unitId: { dealId, unitId: parsed.data.unitId } },
      }),
    )
    if (existingInDeal) {
      return res.status(409).json({ message: 'La unidad ya esta vinculada a esta oportunidad.' })
    }

    const blocking = await findBlockingUnitLink(parsed.data.unitId, dealId)
    if (blocking) {
      return res.status(409).json({
        message: `La unidad ya esta tomada en ${blocking.deal.dealKind === 'CONTRACT' ? 'contrato' : 'concurso'} (${blocking.deal.title}).`,
      })
    }

    const created = await runWithSchemaFailover(() =>
      prisma.$transaction(async (tx) => {
        const link = await tx.crmDealUnit.create({
          data: {
            dealId,
            unitId: parsed.data.unitId,
            status: parsed.data.status,
            notes: normalizeText(parsed.data.notes),
            createdByUserId: req.userId,
            releasedAt: parsed.data.status === 'LIBERADA' || parsed.data.status === 'PERDIDA' ? new Date() : null,
          },
          include: {
            unit: { select: { id: true, internalCode: true, ownerCompany: true, clientName: true } },
          },
        })

        await tx.crmActivity.create({
          data: {
            dealId,
            type: 'TASK',
            status: 'DONE',
            summary: `Unidad ${unit.internalCode} vinculada (${parsed.data.status}).`,
            completedAt: new Date(),
            createdByUserId: req.userId,
          },
        })

        return link
      }),
    )

    return res.status(201).json(created)
  } catch (error) {
    console.error('CRM add deal unit error:', error)
    return res.status(500).json({ message: 'No se pudo vincular la unidad.' })
  }
})

router.patch('/deals/:dealId/units/:linkId', requirePermission('CRM', 'edit'), async (req: any, res) => {
  const parsed = dealUnitUpdateSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
  }
  if (!req.userId) {
    return res.status(401).json({ message: 'No autorizado.' })
  }

  try {
    const dealId = typeof req.params.dealId === 'string' ? req.params.dealId : null
    const linkId = typeof req.params.linkId === 'string' ? req.params.linkId : null
    if (!dealId || !linkId) {
      return res.status(400).json({ message: 'Parametros invalidos.' })
    }

    const existing = await runWithSchemaFailover(() =>
      prisma.crmDealUnit.findUnique({
        where: { id: linkId },
        include: { unit: { select: { internalCode: true } } },
      }),
    )

    if (!existing || existing.dealId !== dealId) {
      return res.status(404).json({ message: 'Vinculo no encontrado.' })
    }

    if ((parsed.data.status === 'EN_CONCURSO' || parsed.data.status === 'ADJUDICADA') && existing.status !== parsed.data.status) {
      const blocking = await findBlockingUnitLink(existing.unitId, dealId)
      if (blocking) {
        return res.status(409).json({
          message: `La unidad ya esta tomada en ${blocking.deal.dealKind === 'CONTRACT' ? 'contrato' : 'concurso'} (${blocking.deal.title}).`,
        })
      }
    }

    const updated = await runWithSchemaFailover(() =>
      prisma.$transaction(async (tx) => {
        const link = await tx.crmDealUnit.update({
          where: { id: linkId },
          data: {
            status: parsed.data.status,
            notes: normalizeText(parsed.data.notes),
            releasedAt: parsed.data.status === 'LIBERADA' || parsed.data.status === 'PERDIDA' ? new Date() : null,
          },
          include: {
            unit: { select: { id: true, internalCode: true, ownerCompany: true, clientName: true } },
          },
        })

        await tx.crmActivity.create({
          data: {
            dealId,
            type: 'TASK',
            status: 'DONE',
            summary: `Unidad ${existing.unit.internalCode} actualizada a ${parsed.data.status}.`,
            completedAt: new Date(),
            createdByUserId: req.userId,
          },
        })

        return link
      }),
    )
    return res.json(updated)
  } catch (error) {
    console.error('CRM update deal unit error:', error)
    return res.status(500).json({ message: 'No se pudo actualizar la unidad vinculada.' })
  }
})

router.delete('/deals/:dealId/units/:linkId', requirePermission('CRM', 'edit'), async (req: any, res) => {
  if (!req.userId) {
    return res.status(401).json({ message: 'No autorizado.' })
  }
  try {
    const dealId = typeof req.params.dealId === 'string' ? req.params.dealId : null
    const linkId = typeof req.params.linkId === 'string' ? req.params.linkId : null
    if (!dealId || !linkId) {
      return res.status(400).json({ message: 'Parametros invalidos.' })
    }

    const existing = await runWithSchemaFailover(() =>
      prisma.crmDealUnit.findUnique({
        where: { id: linkId },
        include: { unit: { select: { internalCode: true } } },
      }),
    )
    if (!existing || existing.dealId !== dealId) {
      return res.status(404).json({ message: 'Vinculo no encontrado.' })
    }

    await runWithSchemaFailover(() =>
      prisma.$transaction(async (tx) => {
        await tx.crmDealUnit.delete({ where: { id: linkId } })
        await tx.crmActivity.create({
          data: {
            dealId,
            type: 'TASK',
            status: 'DONE',
            summary: `Unidad ${existing.unit.internalCode} desvinculada de la oportunidad.`,
            completedAt: new Date(),
            createdByUserId: req.userId,
          },
        })
      }),
    )

    return res.status(204).send()
  } catch (error) {
    console.error('CRM delete deal unit error:', error)
    return res.status(500).json({ message: 'No se pudo desvincular la unidad.' })
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
