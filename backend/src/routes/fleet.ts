import { Router } from 'express'
import { z } from 'zod'
import { getActiveDbSchema, prisma, runWithSchemaFailover } from '../db.js'

const router = Router()

const formatFleetDeleteBlockersMessage = (blockers: Record<string, number>): string => {
  const labelMap: Record<string, string> = {
    maintenancePlans: 'planes de mantenimiento',
    audits: 'inspecciones',
    workOrders: 'ordenes de trabajo',
    repairs: 'reparaciones',
    externalRequests: 'notas de pedido',
    movements: 'movimientos/remitos',
    deliveries: 'entregas/devoluciones',
    linkedTractors: 'tractores vinculados a ese semirremolque',
  }

  const parts = Object.entries(blockers)
    .filter(([, count]) => count > 0)
    .map(([key, count]) => `${count} ${labelMap[key] ?? key}`)

  return parts.length > 0
    ? `No se puede eliminar la unidad porque tiene ${parts.join(', ')} asociadas.`
    : 'No se puede eliminar la unidad porque tiene registros asociados.'
}

const isMissingOrExpired = (expiresAt?: string): boolean => {
  if (!expiresAt) {
    return true
  }
  const date = new Date(expiresAt)
  if (Number.isNaN(date.getTime())) {
    return true
  }
  return date.getTime() < new Date().setHours(0, 0, 0, 0)
}

const unitTypesWithHydroCrane = new Set([
  'CHASSIS_WITH_HYDROCRANE',
  'TRACTOR_WITH_HYDROCRANE',
])
const unitTypesWithoutHoist = new Set(['SEMI_TRAILER', 'AUTOMOBILE', 'VAN', 'PICKUP'])

const requiresHoist = (data: { hasHydroCrane?: boolean; unitType?: string }): boolean => {
  if (data.unitType && unitTypesWithoutHoist.has(data.unitType)) {
    return false
  }
  if (data.hasHydroCrane) {
    return true
  }
  if (data.unitType && unitTypesWithHydroCrane.has(data.unitType)) {
    return true
  }
  return false
}

const hasInvalidDocuments = (documents: any, needsHoist: boolean): boolean => {
  if (!documents) {
    return true
  }
  return (
    isMissingOrExpired(documents?.rto?.expiresAt) ||
    isMissingOrExpired(documents?.insurance?.expiresAt) ||
    (needsHoist && !documents?.hoistNotApplicable ? isMissingOrExpired(documents?.hoist?.expiresAt) : false)
  )
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

const normalizeLegacyUnit = (unit: any) => ({
  ...unit,
  clientId: unit.clientId ?? null,
  clientName: unit.clientName ?? '',
  logisticsStatus: unit.logisticsStatus ?? 'AVAILABLE',
  logisticsStatusNote: unit.logisticsStatusNote ?? '',
  logisticsUpdatedAt: unit.logisticsUpdatedAt ?? null,
})

const hasFleetColumn = async (columnName: string): Promise<boolean> => {
  const activeSchema = getActiveDbSchema()
  try {
    const rows = await prisma.$queryRaw<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE lower(table_schema) = lower(${activeSchema})
          AND table_name = 'FleetUnit'
          AND column_name = ${columnName}
      ) AS exists
    `
    return Boolean(rows[0]?.exists)
  } catch {
    return false
  }
}

const readLegacyFleetUnits = async (): Promise<any[]> => {
  const activeSchema = getActiveDbSchema().replace(/"/g, '')
  return prisma.$queryRawUnsafe<any[]>(`SELECT * FROM "${activeSchema}"."FleetUnit"`)
}

const readLegacyFleetUnitById = async (id: string): Promise<any | null> => {
  const activeSchema = getActiveDbSchema().replace(/"/g, '')
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT * FROM "${activeSchema}"."FleetUnit" WHERE "id" = '${String(id).replace(/'/g, "''")}' LIMIT 1`,
  )
  return rows[0] ?? null
}

const hasCrmDealUnitTable = async (): Promise<boolean> => {
  try {
    const rows = await prisma.$queryRaw<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = current_schema()
          AND table_name = 'CrmDealUnit'
      ) AS exists
    `
    return Boolean(rows[0]?.exists)
  } catch {
    return false
  }
}

const enrichUnitsWithCrmVisibility = async <T extends { id: string }>(units: T[]): Promise<Array<T & { crmDealLink?: any }>> => {
  if (!units.length) {
    return units.map((unit) => ({ ...unit, crmDealLink: null }))
  }

  const canReadLinks = await hasCrmDealUnitTable()
  if (!canReadLinks) {
    return units.map((unit) => ({ ...unit, crmDealLink: null }))
  }

  try {
    const links = await prisma.crmDealUnit.findMany({
      where: {
        unitId: { in: units.map((unit) => unit.id) },
        status: { in: ['EN_CONCURSO', 'ADJUDICADA'] as any },
      },
      include: {
        deal: {
          select: { id: true, title: true, companyName: true, dealKind: true, stage: true },
        },
      },
      orderBy: [{ linkedAt: 'desc' }],
    })

    const mapByUnit = new Map<string, (typeof links)[number]>()
    links.forEach((link) => {
      if (!mapByUnit.has(link.unitId)) {
        mapByUnit.set(link.unitId, link)
      }
    })

    return units.map((unit) => ({
      ...unit,
      crmDealLink: mapByUnit.get(unit.id)
        ? {
            dealId: mapByUnit.get(unit.id)?.deal.id,
            dealTitle: mapByUnit.get(unit.id)?.deal.title,
            dealKind: mapByUnit.get(unit.id)?.deal.dealKind,
            companyName: mapByUnit.get(unit.id)?.deal.companyName,
            stage: mapByUnit.get(unit.id)?.deal.stage,
            status: mapByUnit.get(unit.id)?.status,
          }
        : null,
    }))
  } catch {
    return units.map((unit) => ({ ...unit, crmDealLink: null }))
  }
}

type FleetOperationalStatus = 'OPERATIONAL' | 'MAINTENANCE' | 'OUT_OF_SERVICE'

const deriveOperationalStatus = (
  requested: FleetOperationalStatus,
  documents: any,
  needsHoist: boolean,
): FleetOperationalStatus => (hasInvalidDocuments(documents, needsHoist) ? 'OUT_OF_SERVICE' : requested)

const normalizeSemiTrailerUnitId = async (
  semiTrailerUnitId: unknown,
  hasSemiTrailer: boolean,
): Promise<string | null> => {
  if (!hasSemiTrailer) {
    return null
  }
  if (typeof semiTrailerUnitId !== 'string' || !semiTrailerUnitId.trim()) {
    return null
  }
  const existing = await prisma.fleetUnit.findUnique({ where: { id: semiTrailerUnitId } })
  return existing ? semiTrailerUnitId : null
}

const normalizeClientAssignment = async (
  clientIdInput: unknown,
  clientNameInput: unknown,
): Promise<{ clientId: string | null; clientName: string }> => {
  const rawClientId = typeof clientIdInput === 'string' ? clientIdInput.trim() : ''
  if (rawClientId) {
    const matchedById = await prisma.clientAccount.findUnique({
      where: { id: rawClientId },
      select: { id: true, name: true },
    })
    if (matchedById) {
      return { clientId: matchedById.id, clientName: matchedById.name }
    }
  }

  const normalizedClientName = typeof clientNameInput === 'string' ? clientNameInput.trim() : ''
  if (!normalizedClientName) {
    return { clientId: null, clientName: '' }
  }

  const matchedByName = await prisma.clientAccount.findFirst({
    where: { name: { equals: normalizedClientName, mode: 'insensitive' } },
    select: { id: true, name: true },
  })

  if (matchedByName) {
    return { clientId: matchedByName.id, clientName: matchedByName.name }
  }

  return { clientId: null, clientName: normalizedClientName }
}

const fleetSchema = z.object({
  id: z.string().uuid().optional(),
  qrId: z.string().min(1),
  internalCode: z.string().min(1),
  brand: z.string().optional().default(''),
  model: z.string().optional().default(''),
  year: z.number().int().optional().default(0),
  clientId: z.string().nullable().optional(),
  clientName: z.string().optional().default(''),
  location: z.string().optional().default(''),
  ownerCompany: z.string().min(1),
  operationalStatus: z.enum(['OPERATIONAL', 'MAINTENANCE', 'OUT_OF_SERVICE']),
  logisticsStatus: z
    .enum(['AVAILABLE', 'PENDING_DELIVERY', 'DELIVERED', 'PENDING_RETURN', 'RETURNED'])
    .optional()
    .default('AVAILABLE'),
  logisticsStatusNote: z.string().optional().default(''),
  logisticsUpdatedAt: z.string().optional().default(''),
  unitType: z.enum([
    'CHASSIS',
    'CHASSIS_WITH_HYDROCRANE',
    'TRACTOR',
    'TRACTOR_WITH_HYDROCRANE',
    'SEMI_TRAILER',
    'AUTOMOBILE',
    'VAN',
    'PICKUP',
  ]),
  configurationNotes: z.string().optional().default(''),
  chassisNumber: z.string().min(1),
  engineNumber: z.string().optional().default(''),
  tareWeightKg: z.number().int().nonnegative(),
  maxLoadKg: z.number().int().nonnegative(),
  hasHydroCrane: z.boolean(),
  hydroCraneBrand: z.string().optional().default(''),
  hydroCraneModel: z.string().optional().default(''),
  hydroCraneSerialNumber: z.string().optional().default(''),
  hasSemiTrailer: z.boolean(),
  semiTrailerUnitId: z.string().nullable().optional(),
  semiTrailerLicensePlate: z.string().optional().default(''),
  semiTrailerBrand: z.string().optional().default(''),
  semiTrailerModel: z.string().optional().default(''),
  semiTrailerYear: z.number().int().optional().default(0),
  semiTrailerChassisNumber: z.string().optional().default(''),
  tractorHistoryIds: z.array(z.string()).optional().default([]),
  currentKilometers: z.number().int().nonnegative().optional().default(0),
  currentEngineHours: z.number().int().nonnegative().optional().default(0),
  currentHydroHours: z.number().int().nonnegative().optional().default(0),
  lubricants: z.any().optional().default({}),
  filters: z.any().optional().default({}),
  documents: z.any().optional().default({}),
})

const toTrimmedString = (value: unknown): string => {
  if (typeof value === 'string') {
    return value.trim()
  }
  if (value === null || value === undefined) {
    return ''
  }
  return String(value).trim()
}

const toOptionalIsoDate = (value: unknown): string | '' | undefined => {
  if (value === undefined) {
    return undefined
  }
  if (value === null) {
    return ''
  }
  const text = toTrimmedString(value)
  if (!text) {
    return ''
  }
  const date = new Date(text)
  if (Number.isNaN(date.getTime())) {
    return undefined
  }
  return date.toISOString()
}

const toOptionalBoolean = (value: unknown): boolean | undefined => {
  if (value === undefined) {
    return undefined
  }
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    if (value === 1) return true
    if (value === 0) return false
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['true', '1', 'si', 'yes'].includes(normalized)) return true
    if (['false', '0', 'no'].includes(normalized)) return false
  }
  return undefined
}

const toOptionalInt = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === '') {
    return undefined
  }
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined
  }
  return Math.trunc(parsed)
}

const sanitizeFleetPatchData = (rawBody: Record<string, unknown>): Partial<z.infer<typeof fleetSchema>> => {
  const patchData: Partial<z.infer<typeof fleetSchema>> = {}

  const setString = (key: keyof z.infer<typeof fleetSchema>) => {
    if (Object.prototype.hasOwnProperty.call(rawBody, key)) {
      ;(patchData as any)[key] = toTrimmedString(rawBody[key as string])
    }
  }

  const setNullableString = (key: keyof z.infer<typeof fleetSchema>) => {
    if (Object.prototype.hasOwnProperty.call(rawBody, key)) {
      const text = toTrimmedString(rawBody[key as string])
      ;(patchData as any)[key] = text ? text : null
    }
  }

  const setInt = (key: keyof z.infer<typeof fleetSchema>) => {
    if (Object.prototype.hasOwnProperty.call(rawBody, key)) {
      const next = toOptionalInt(rawBody[key as string])
      if (next !== undefined) {
        ;(patchData as any)[key] = next
      }
    }
  }

  const setBoolean = (key: keyof z.infer<typeof fleetSchema>) => {
    if (Object.prototype.hasOwnProperty.call(rawBody, key)) {
      const next = toOptionalBoolean(rawBody[key as string])
      if (next !== undefined) {
        ;(patchData as any)[key] = next
      }
    }
  }

  setString('qrId')
  setString('internalCode')
  setString('brand')
  setString('model')
  setNullableString('clientId')
  setString('clientName')
  setString('location')
  setString('ownerCompany')
  setString('configurationNotes')
  setString('chassisNumber')
  setString('engineNumber')
  setString('hydroCraneBrand')
  setString('hydroCraneModel')
  setString('hydroCraneSerialNumber')
  setNullableString('semiTrailerUnitId')
  setString('semiTrailerLicensePlate')
  setString('semiTrailerBrand')
  setString('semiTrailerModel')
  setString('logisticsStatusNote')

  setInt('year')
  setInt('tareWeightKg')
  setInt('maxLoadKg')
  setInt('semiTrailerYear')
  setInt('currentKilometers')
  setInt('currentEngineHours')
  setInt('currentHydroHours')

  setBoolean('hasHydroCrane')
  setBoolean('hasSemiTrailer')

  if (Object.prototype.hasOwnProperty.call(rawBody, 'operationalStatus')) {
    const next = toTrimmedString(rawBody.operationalStatus)
    if (next === 'OPERATIONAL' || next === 'MAINTENANCE' || next === 'OUT_OF_SERVICE') {
      patchData.operationalStatus = next
    }
  }

  if (Object.prototype.hasOwnProperty.call(rawBody, 'logisticsStatus')) {
    const next = toTrimmedString(rawBody.logisticsStatus)
    if (next === 'AVAILABLE' || next === 'PENDING_DELIVERY' || next === 'DELIVERED' || next === 'PENDING_RETURN' || next === 'RETURNED') {
      patchData.logisticsStatus = next as any
    }
  }

  if (Object.prototype.hasOwnProperty.call(rawBody, 'unitType')) {
    const next = toTrimmedString(rawBody.unitType)
    if (
      next === 'CHASSIS' ||
      next === 'CHASSIS_WITH_HYDROCRANE' ||
      next === 'TRACTOR' ||
      next === 'TRACTOR_WITH_HYDROCRANE' ||
      next === 'SEMI_TRAILER' ||
      next === 'AUTOMOBILE' ||
      next === 'VAN' ||
      next === 'PICKUP'
    ) {
      patchData.unitType = next as any
    }
  }

  if (Object.prototype.hasOwnProperty.call(rawBody, 'tractorHistoryIds') && Array.isArray(rawBody.tractorHistoryIds)) {
    patchData.tractorHistoryIds = rawBody.tractorHistoryIds.map((item) => String(item ?? '').trim()).filter(Boolean)
  }

  if (Object.prototype.hasOwnProperty.call(rawBody, 'lubricants') && rawBody.lubricants && typeof rawBody.lubricants === 'object') {
    patchData.lubricants = rawBody.lubricants
  }
  if (Object.prototype.hasOwnProperty.call(rawBody, 'filters') && rawBody.filters && typeof rawBody.filters === 'object') {
    patchData.filters = rawBody.filters
  }
  if (Object.prototype.hasOwnProperty.call(rawBody, 'documents') && rawBody.documents && typeof rawBody.documents === 'object') {
    patchData.documents = rawBody.documents
  }

  if (Object.prototype.hasOwnProperty.call(rawBody, 'logisticsUpdatedAt')) {
    const next = toOptionalIsoDate(rawBody.logisticsUpdatedAt)
    if (next !== undefined) {
      patchData.logisticsUpdatedAt = next
    }
  }

  return patchData
}

router.get('/', async (_req, res) => {
  try {
    const hasClientIdColumn = await hasFleetColumn('clientId')
    if (!hasClientIdColumn) {
      const legacyUnits = await readLegacyFleetUnits()
      const normalized = legacyUnits.map(normalizeLegacyUnit)
      const withCrm = await enrichUnitsWithCrmVisibility(normalized)
      return res.json(withCrm)
    }

    const units = await runWithSchemaFailover(() =>
      prisma.fleetUnit.findMany({ orderBy: { createdAt: 'desc' } }),
    )
    const withCrm = await enrichUnitsWithCrmVisibility(units)
    return res.json(withCrm)
  } catch (error) {
    if (isSchemaMismatchError(error)) {
      try {
        const legacyUnits = await readLegacyFleetUnits()
        const normalized = legacyUnits.map(normalizeLegacyUnit)
        const withCrm = await enrichUnitsWithCrmVisibility(normalized)
        return res.json(withCrm)
      } catch {
        // continue with default handling
      }
    }
    console.error('Fleet GET error:', error)
    return res.status(500).json({ message: 'No se pudieron cargar las unidades.' })
  }
})

router.get('/:id', async (req, res) => {
  try {
    const hasClientIdColumn = await hasFleetColumn('clientId')
    if (!hasClientIdColumn) {
      const legacyUnit = await readLegacyFleetUnitById(req.params.id)
      if (!legacyUnit) {
        return res.status(404).json({ message: 'Unidad no encontrada.' })
      }
      const normalized = normalizeLegacyUnit(legacyUnit)
      const withCrm = await enrichUnitsWithCrmVisibility([normalized])
      return res.json(withCrm[0])
    }

    const unit = await runWithSchemaFailover(() =>
      prisma.fleetUnit.findUnique({ where: { id: req.params.id } }),
    )
    if (!unit) {
      return res.status(404).json({ message: 'Unidad no encontrada.' })
    }
    const withCrm = await enrichUnitsWithCrmVisibility([unit])
    return res.json(withCrm[0])
  } catch (error) {
    if (isSchemaMismatchError(error)) {
      try {
        const legacyUnit = await readLegacyFleetUnitById(req.params.id)
        if (!legacyUnit) {
          return res.status(404).json({ message: 'Unidad no encontrada.' })
        }
        const normalized = normalizeLegacyUnit(legacyUnit)
        const withCrm = await enrichUnitsWithCrmVisibility([normalized])
        return res.json(withCrm[0])
      } catch {
        // continue with default handling
      }
    }
    console.error('Fleet GET by id error:', error)
    return res.status(500).json({ message: 'No se pudo cargar la unidad.' })
  }
})

router.post('/', async (req, res) => {
  const parsed = fleetSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
  }

  try {
    const safeSemiTrailerUnitId = await normalizeSemiTrailerUnitId(
      parsed.data.semiTrailerUnitId,
      parsed.data.hasSemiTrailer,
    )
    const clientAssignment = await normalizeClientAssignment(parsed.data.clientId, parsed.data.clientName)
    const normalizedDocuments = {
      ...parsed.data.documents,
      hoistNotApplicable:
        parsed.data.documents?.hoistNotApplicable ?? (parsed.data.unitType ? unitTypesWithoutHoist.has(parsed.data.unitType) : false),
    }
    const operationalStatus = deriveOperationalStatus(
      parsed.data.operationalStatus as FleetOperationalStatus,
      normalizedDocuments,
      requiresHoist(parsed.data),
    )
    const unit = await prisma.fleetUnit.create({
      data: {
        ...parsed.data,
        clientId: clientAssignment.clientId,
        clientName: clientAssignment.clientName,
        logisticsStatusNote: parsed.data.logisticsStatusNote?.trim() ?? '',
        logisticsUpdatedAt: parsed.data.logisticsUpdatedAt ? new Date(parsed.data.logisticsUpdatedAt) : undefined,
        semiTrailerUnitId: safeSemiTrailerUnitId,
        documents: normalizedDocuments,
        operationalStatus,
      },
    })
    return res.status(201).json(unit)
  } catch (error: any) {
    console.error('Fleet POST error:', error)
    if (error?.code === 'P2002') {
      return res.status(409).json({ message: 'Unidad duplicada.' })
    }
    return res.status(500).json({ message: 'No se pudo crear la unidad.' })
  }
})

router.patch('/:id', async (req, res) => {
  const rawBody = (req.body ?? {}) as Record<string, unknown>
  const patchData = sanitizeFleetPatchData(rawBody)
  if (Object.keys(patchData).length === 0) {
    return res.status(400).json({ message: 'No hay campos validos para actualizar.' })
  }

  try {
    const current = await prisma.fleetUnit.findUnique({ where: { id: req.params.id } })
    if (!current) {
      return res.status(404).json({ message: 'Unidad no encontrada.' })
    }
    const currentDocuments = (current.documents as any) ?? {}
    const hasClientPatch =
      Object.prototype.hasOwnProperty.call(rawBody, 'clientId') ||
      Object.prototype.hasOwnProperty.call(rawBody, 'clientName')
    const clientAssignment = hasClientPatch
      ? await normalizeClientAssignment(patchData.clientId, patchData.clientName)
      : { clientId: current.clientId, clientName: current.clientName }
    const nextDocuments = {
      ...(patchData.documents ?? currentDocuments),
      hoistNotApplicable:
        (patchData.documents as any)?.hoistNotApplicable ??
        (patchData.unitType ? unitTypesWithoutHoist.has(patchData.unitType) : currentDocuments.hoistNotApplicable ?? false),
    }
    const requestedStatus = (patchData.operationalStatus ?? current.operationalStatus) as FleetOperationalStatus
    const nextHasHydroCrane = patchData.hasHydroCrane ?? current.hasHydroCrane
    const nextUnitType = patchData.unitType ?? current.unitType
    const safeSemiTrailerUnitId = await normalizeSemiTrailerUnitId(
      patchData.semiTrailerUnitId ?? current.semiTrailerUnitId,
      patchData.hasSemiTrailer ?? current.hasSemiTrailer,
    )
    const operationalStatus = deriveOperationalStatus(requestedStatus, nextDocuments, requiresHoist({
      hasHydroCrane: nextHasHydroCrane,
      unitType: nextUnitType,
    }))
    const unit = await prisma.fleetUnit.update({
      where: { id: req.params.id },
      data: {
        ...patchData,
        clientId: clientAssignment.clientId,
        clientName: clientAssignment.clientName,
        logisticsStatusNote:
          patchData.logisticsStatusNote !== undefined ? patchData.logisticsStatusNote.trim() : current.logisticsStatusNote,
        logisticsUpdatedAt:
          patchData.logisticsUpdatedAt !== undefined
            ? patchData.logisticsUpdatedAt
              ? new Date(patchData.logisticsUpdatedAt)
              : null
            : current.logisticsUpdatedAt,
        semiTrailerUnitId: safeSemiTrailerUnitId,
        documents: nextDocuments,
        operationalStatus,
      },
    })
    return res.json(unit)
  } catch (error: any) {
    console.error('Fleet PATCH error:', error)
    return res.status(500).json({ message: 'No se pudo actualizar la unidad.' })
  }
})

router.delete('/:id', async (req, res) => {
  try {
    const unitId = req.params.id
    const existing = await prisma.fleetUnit.findUnique({ where: { id: unitId }, select: { id: true } })

    if (!existing) {
      return res.status(404).json({ message: 'Unidad no encontrada.' })
    }

    const [
      maintenancePlans,
      audits,
      workOrders,
      repairs,
      externalRequests,
      movements,
      deliveries,
      linkedTractors,
    ] = await prisma.$transaction([
      prisma.maintenancePlan.count({ where: { unitId } }),
      prisma.auditRecord.count({ where: { unitId } }),
      prisma.workOrder.count({ where: { unitId } }),
      prisma.repairRecord.count({ where: { unitId } }),
      prisma.externalRequest.count({ where: { unitId } }),
      prisma.fleetMovementUnit.count({ where: { unitId } }),
      prisma.deliveryOperation.count({ where: { unitId } }),
      prisma.fleetUnit.count({ where: { semiTrailerUnitId: unitId } }),
    ])

    const blockers = {
      maintenancePlans,
      audits,
      workOrders,
      repairs,
      externalRequests,
      movements,
      deliveries,
      linkedTractors,
    }

    const hasBlockers = Object.values(blockers).some((count) => count > 0)
    if (hasBlockers) {
      return res.status(409).json({
        message: formatFleetDeleteBlockersMessage(blockers),
        blockers,
      })
    }

    await prisma.fleetUnit.delete({ where: { id: unitId } })
    return res.status(204).send()
  } catch (error) {
    console.error('Fleet DELETE error:', error)
    return res.status(500).json({ message: 'No se pudo eliminar la unidad.' })
  }
})

export default router
