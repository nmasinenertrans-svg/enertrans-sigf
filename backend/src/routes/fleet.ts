import { Router } from 'express'
import { z } from 'zod'
import { getActiveDbSchema, prisma, runWithSchemaFailover } from '../db.js'

const router = Router()

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

router.get('/', async (_req, res) => {
  try {
    const hasClientIdColumn = await hasFleetColumn('clientId')
    if (!hasClientIdColumn) {
      const legacyUnits = await readLegacyFleetUnits()
      return res.json(legacyUnits.map(normalizeLegacyUnit))
    }

    const units = await runWithSchemaFailover(() =>
      prisma.fleetUnit.findMany({ orderBy: { createdAt: 'desc' } }),
    )
    return res.json(units)
  } catch (error) {
    if (isSchemaMismatchError(error)) {
      try {
        const legacyUnits = await readLegacyFleetUnits()
        return res.json(legacyUnits.map(normalizeLegacyUnit))
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
      return res.json(normalizeLegacyUnit(legacyUnit))
    }

    const unit = await runWithSchemaFailover(() =>
      prisma.fleetUnit.findUnique({ where: { id: req.params.id } }),
    )
    if (!unit) {
      return res.status(404).json({ message: 'Unidad no encontrada.' })
    }
    return res.json(unit)
  } catch (error) {
    if (isSchemaMismatchError(error)) {
      try {
        const legacyUnit = await readLegacyFleetUnitById(req.params.id)
        if (!legacyUnit) {
          return res.status(404).json({ message: 'Unidad no encontrada.' })
        }
        return res.json(normalizeLegacyUnit(legacyUnit))
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
  const parsed = fleetSchema.partial().safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
  }

  const rawBody = (req.body ?? {}) as Record<string, unknown>
  const patchData = Object.fromEntries(
    Object.entries(parsed.data).filter(([key]) => Object.prototype.hasOwnProperty.call(rawBody, key)),
  ) as Partial<z.infer<typeof fleetSchema>>

  try {
    const current = await prisma.fleetUnit.findUnique({ where: { id: req.params.id } })
    if (!current) {
      if (patchData.id && patchData.qrId) {
        const safeSemiTrailerUnitId = await normalizeSemiTrailerUnitId(
          patchData.semiTrailerUnitId,
          patchData.hasSemiTrailer ?? false,
        )
        const clientAssignment = await normalizeClientAssignment(patchData.clientId, patchData.clientName)
        const operationalStatus = deriveOperationalStatus(
          (patchData.operationalStatus ?? 'OPERATIONAL') as FleetOperationalStatus,
          patchData.documents ?? {},
          requiresHoist(patchData),
        )
        const created = await prisma.fleetUnit.create({
          data: {
            ...patchData,
            clientId: clientAssignment.clientId,
            clientName: clientAssignment.clientName,
            logisticsStatusNote: patchData.logisticsStatusNote?.trim() ?? '',
            logisticsUpdatedAt: patchData.logisticsUpdatedAt ? new Date(patchData.logisticsUpdatedAt) : undefined,
            semiTrailerUnitId: safeSemiTrailerUnitId,
            operationalStatus,
          } as any,
        })
        return res.status(201).json(created)
      }
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
  await prisma.fleetUnit.delete({ where: { id: req.params.id } })
  return res.status(204).send()
})

export default router
