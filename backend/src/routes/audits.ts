import { Router } from 'express'
import { z } from 'zod'
import type { Prisma } from '@prisma/client'
import { prisma } from '../db.js'
import { formatCode, getNextSequence } from '../utils/sequence.js'
import { supabase, supabaseBucket } from '../storage/supabase.js'

const router = Router()
const AUDIT_DUPLICATE_WINDOW_MS = 10 * 60 * 1000

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

const forensicSearchSchema = z.object({
  unitId: z.string().optional(),
  unitCode: z.string().optional(),
  auditor: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
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
      item: 'Desvios detectados en inspeccion',
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

const isManualAuditModeEnabled = async (): Promise<boolean> => {
  const settings = await prisma.appSettings.findUnique({ where: { id: 'app' } })
  const featureFlags =
    settings?.featureFlags && typeof settings.featureFlags === 'object' && !Array.isArray(settings.featureFlags)
      ? (settings.featureFlags as Record<string, unknown>)
      : {}
  return featureFlags.manualAuditMode === true
}

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

const areAuditPayloadsEquivalent = (
  existing: {
    workOrderId: string | null
    observations: string
    checklist: unknown
    unitKilometers: number
    engineHours: number
    hydroHours: number
    photoUrls: unknown
  },
  incoming: {
    workOrderId?: string
    observations?: string
    checklist?: unknown
    unitKilometers?: number
    engineHours?: number
    hydroHours?: number
    photoUrls?: string[]
  },
) => {
  const existingPhotoCount = Array.isArray(existing.photoUrls) ? existing.photoUrls.length : 0
  const incomingPhotoCount = Array.isArray(incoming.photoUrls) ? incoming.photoUrls.length : 0

  return (
    (existing.workOrderId ?? null) === (incoming.workOrderId ?? null) &&
    normalizeText(existing.observations) === normalizeText(incoming.observations) &&
    existing.unitKilometers === (incoming.unitKilometers ?? 0) &&
    existing.engineHours === (incoming.engineHours ?? 0) &&
    existing.hydroHours === (incoming.hydroHours ?? 0) &&
    existingPhotoCount === incomingPhotoCount &&
    stableStringify(existing.checklist ?? {}) === stableStringify(incoming.checklist ?? {})
  )
}

const extractStoragePath = (url: string | null | undefined): string | null => {
  const value = (url ?? '').trim()
  if (!value) {
    return null
  }
  const marker = `/storage/v1/object/public/${supabaseBucket}/`
  const markerIndex = value.indexOf(marker)
  if (markerIndex < 0) {
    return null
  }
  return value.slice(markerIndex + marker.length)
}

router.get('/', async (_req, res) => {
  const items = await prisma.auditRecord.findMany({ orderBy: { createdAt: 'desc' } })
  return res.json(items)
})

router.get('/forensics/search', async (req, res) => {
  const parsed = forensicSearchSchema.safeParse(req.query)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Parametros invalidos.' })
  }

  const { unitId, unitCode, auditor, dateFrom, dateTo, limit } = parsed.data
  const where: Prisma.AuditRecordWhereInput = {}

  if (unitId?.trim()) {
    where.unitId = unitId.trim()
  }

  if (unitCode?.trim()) {
    const matchingUnits = await prisma.fleetUnit.findMany({
      where: {
        internalCode: {
          contains: unitCode.trim(),
          mode: 'insensitive',
        },
      },
      select: { id: true },
      take: 100,
    })
    const ids = matchingUnits.map((item) => item.id)
    if (ids.length === 0) {
      return res.json([])
    }
    where.unitId = where.unitId ? where.unitId : { in: ids }
  }

  if (auditor?.trim()) {
    where.auditorName = {
      contains: auditor.trim(),
      mode: 'insensitive',
    }
  }

  if (dateFrom || dateTo) {
    where.performedAt = {}
    if (dateFrom) {
      const from = new Date(dateFrom)
      if (!Number.isNaN(from.getTime())) {
        where.performedAt.gte = from
      }
    }
    if (dateTo) {
      const to = new Date(dateTo)
      if (!Number.isNaN(to.getTime())) {
        where.performedAt.lte = to
      }
    }
  }

  const items = await prisma.auditRecord.findMany({
    where,
    include: {
      unit: {
        select: {
          id: true,
          internalCode: true,
          ownerCompany: true,
        },
      },
    },
    orderBy: { performedAt: 'desc' },
    take: limit ?? 200,
  })

  return res.json(
    items.map((item) => ({
      id: item.id,
      code: item.code,
      performedAt: item.performedAt,
      result: item.result,
      auditorName: item.auditorName,
      unitId: item.unitId,
      unitInternalCode: item.unit?.internalCode ?? null,
      ownerCompany: item.unit?.ownerCompany ?? null,
      observations: item.observations,
      hasPhotos: Array.isArray(item.photoUrls) && item.photoUrls.length > 0,
    })),
  )
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

  const manualAuditMode = await isManualAuditModeEnabled()
  const auditKind = manualAuditMode ? 'AUDIT' : parsed.data.auditKind ?? (await resolveAuditKind(parsed.data.unitId))
  const performedAtDate = new Date(parsed.data.performedAt)

  if (Number.isNaN(performedAtDate.getTime())) {
    return res.status(400).json({ message: 'Fecha de inspeccion invalida.' })
  }

  const performedAtFrom = new Date(performedAtDate.getTime() - AUDIT_DUPLICATE_WINDOW_MS)
  const performedAtTo = new Date(performedAtDate.getTime() + AUDIT_DUPLICATE_WINDOW_MS)

  const duplicateCandidates = await prisma.auditRecord.findMany({
    where: {
      unitId: parsed.data.unitId,
      auditorUserId: parsed.data.auditorUserId,
      result: parsed.data.result,
      auditKind,
      performedAt: {
        gte: performedAtFrom,
        lte: performedAtTo,
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  })

  const duplicate = duplicateCandidates.find((candidate) =>
    areAuditPayloadsEquivalent(candidate, {
      workOrderId: parsed.data.workOrderId,
      observations: parsed.data.observations,
      checklist: parsed.data.checklist,
      unitKilometers: parsed.data.unitKilometers,
      engineHours: parsed.data.engineHours,
      hydroHours: parsed.data.hydroHours,
      photoUrls: parsed.data.photoUrls,
    }),
  )

  if (duplicate) {
    return res.status(200).json(duplicate)
  }

  const unit = await prisma.fleetUnit.findUnique({
    where: { id: parsed.data.unitId },
    select: { internalCode: true },
  })
  const unitCode = unit?.internalCode ?? ''
  // Server must be the source of truth for audit codes.
  // Frontend/local sequence can drift (PWA/offline/cache/reset) and cause collisions.
  const code = formatCode(auditKind === 'REAUDIT' ? 'RINS' : 'INS', await getNextSequence(auditKind), unitCode)

  const data = {
    id: parsed.data.id,
    code,
    auditKind,
    unitId: parsed.data.unitId,
    auditorUserId: parsed.data.auditorUserId,
    auditorName: parsed.data.auditorName,
    performedAt: performedAtDate,
    result: parsed.data.result,
    observations: parsed.data.observations,
    photoUrls: parsed.data.photoUrls,
    checklist:
      parsed.data.checklist && typeof parsed.data.checklist === 'object'
        ? parsed.data.checklist
        : { sections: [] },
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
      if (!manualAuditMode) {
        const workOrderCode = parsed.data.workOrderCode ?? formatCode('OT', await getNextSequence('workOrder'), unitCode)
        await prisma.workOrder.create({
          data: {
            id: parsed.data.workOrderId,
            code: workOrderCode,
            pendingReaudit: false,
            unitId: item.unitId,
            status: 'OPEN',
            taskList: extractBadItems(parsed.data.checklist),
            spareParts: [],
            laborDetail: `Desvios detectados en inspeccion ${code}`,
            linkedInventorySkuList: [],
          },
        })
      }

      await prisma.fleetUnit.update({
        where: { id: item.unitId },
        data: { operationalStatus: 'OUT_OF_SERVICE' },
      })
    } else {
      if (!manualAuditMode && parsed.data.workOrderId) {
        await prisma.workOrder.updateMany({
          where: { id: parsed.data.workOrderId },
          data: { pendingReaudit: false },
        })
      }
      if (!manualAuditMode) {
        await prisma.workOrder.updateMany({
          where: { unitId: item.unitId, pendingReaudit: true },
          data: { pendingReaudit: false },
        })
      }
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
    console.error('Error creando inspeccion:', error)
    return res.status(500).json({ message: 'No se pudo crear la inspeccion.' })
  }
})

router.delete('/:id', async (req, res) => {
  const record = await prisma.auditRecord.findUnique({
    where: { id: req.params.id },
    select: { photoUrls: true, checklist: true },
  })

  await prisma.auditRecord.delete({ where: { id: req.params.id } })

  const candidatePaths = new Set<string>()
  if (Array.isArray(record?.photoUrls)) {
    record.photoUrls.forEach((value) => {
      if (typeof value === 'string') {
        const path = extractStoragePath(value)
        if (path) {
          candidatePaths.add(path)
        }
      }
    })
  }

  const reportUrl =
    record?.checklist && typeof record.checklist === 'object' && !Array.isArray(record.checklist)
      ? (record.checklist as any)?.meta?.reportPdfFileUrl
      : ''
  if (typeof reportUrl === 'string') {
    const path = extractStoragePath(reportUrl)
    if (path) {
      candidatePaths.add(path)
    }
  }

  if (candidatePaths.size > 0) {
    await supabase.storage.from(supabaseBucket).remove(Array.from(candidatePaths))
  }

  return res.status(204).send()
})

export default router



