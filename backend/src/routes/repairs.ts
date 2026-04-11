import { Router } from 'express'
import { z } from 'zod'
import { prisma, runWithSchemaFailover } from '../db.js'
import { getErrorCode } from '../utils/errors.js'
import type { AuthenticatedRequest } from '../middleware/auth.js'
import { pushUserNotifications, resolveOperationalNotificationRecipients } from '../services/userNotifications.js'

const router = Router()

const CURRENCY_CODES = ['ARS', 'USD'] as const
const REPAIR_OPERATIONAL_COLUMNS = [
  'performedAt',
  'unitKilometers',
  'currency',
  'linkedExternalRequestIds',
  'laborCost',
  'partsCost',
] as const
const REPAIR_COLUMNS_CACHE_MS = 5 * 60 * 1000

const repairSchema = z.object({
  id: z.string().min(1).optional(),
  unitId: z.string().min(1),
  sourceType: z.enum(['WORK_ORDER', 'EXTERNAL_REQUEST']).optional(),
  workOrderId: z.string().optional(),
  externalRequestId: z.string().optional(),
  linkedExternalRequestIds: z.array(z.string().min(1)).optional(),
  supplierId: z.string().optional(),
  performedAt: z.string().datetime().optional(),
  unitKilometers: z.number().int().min(0).optional(),
  currency: z.enum(CURRENCY_CODES).optional(),
  supplierName: z.string().min(1),
  laborCost: z.number().min(0).optional(),
  partsCost: z.number().min(0).optional(),
  realCost: z.number().min(0).optional(),
  invoicedToClient: z.number().min(0),
  margin: z.number().optional(),
  invoiceFileName: z.string().optional(),
  invoiceFileBase64: z.string().optional(),
  invoiceFileUrl: z.string().optional(),
})

const repairUpdateSchema = repairSchema.partial()

type RepairInput = z.infer<typeof repairSchema>

type LegacyRepairRow = {
  id: string
  unitId: string
  workOrderId: string | null
  externalRequestId: string | null
  sourceType: string | null
  supplierName: string
  realCost: number
  invoicedToClient: number
  margin: number
  invoiceFileName: string
  invoiceFileBase64: string
  invoiceFileUrl: string
  createdAt: Date
  updatedAt: Date
}

type RecoveryRepairRow = {
  id: string
  unitId: string
  workOrderId: string | null
  externalRequestId: string | null
  sourceType: string | null
  supplierId: string | null
  supplierName: string
  linkedExternalRequestIds: unknown
  laborCost: number | null
  partsCost: number | null
  realCost: number
  invoicedToClient: number
  margin: number
  invoiceFileName: string | null
  invoiceFileBase64: string | null
  invoiceFileUrl: string | null
  createdAt: Date | string
  updatedAt: Date | string
  performedAt: Date | string | null
  unitKilometers: number | null
  currency: string | null
}

type ExternalRequestLinkRow = {
  id: string
  unitId: string
  code: string
  currency: string
  partsTotal: number
  eligibilityStatus: string
  providerFileUrl: string
  linkedRepairId: string | null
}

type FinancialParams = {
  linkedRequests: ExternalRequestLinkRow[]
  laborCostInput?: number
  realCostInput?: number
  existingLaborCost?: number
  existingPartsCost?: number
  existingRealCost?: number
  invoicedInput?: number
  existingInvoiced?: number
}

class RepairRequestError extends Error {
  status: number
  code: string

  constructor(message: string, status = 400, code = 'REPAIR_REQUEST_INVALID') {
    super(message)
    this.name = 'RepairRequestError'
    this.status = status
    this.code = code
  }
}

const REPAIR_RECOVERY_SCHEMAS = ['enertrans_prod', 'public'] as const

let repairColumnsSupportCache: { checkedAt: number; supported: boolean } | null = null

const createId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `repair-${Date.now()}-${Math.round(Math.random() * 100000)}`
}

const isMissingOperationalColumnError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') {
    return false
  }
  const maybeError = error as { code?: string; message?: string }
  if (maybeError.code === 'P2022') {
    return true
  }
  const message = String(maybeError.message ?? '').toLowerCase()
  return message.includes('column') && message.includes('repairrecord')
}

const asIsoString = (value: Date | string | null | undefined): string | undefined => {
  if (!value) {
    return undefined
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString()
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return undefined
  }
  return parsed.toISOString()
}

const normalizeCurrency = (value: unknown): (typeof CURRENCY_CODES)[number] => (value === 'USD' ? 'USD' : 'ARS')

const toNonNegativeNumber = (value: unknown, fallback = 0): number => {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback
  }
  return Number(parsed.toFixed(2))
}

const parseLinkedExternalRequestIds = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) {
    return []
  }
  const unique = new Set<string>()
  raw.forEach((value) => {
    const normalized = String(value ?? '').trim()
    if (normalized) {
      unique.add(normalized)
    }
  })
  return Array.from(unique)
}

const resolveLinkedExternalRequestIds = (
  data: { linkedExternalRequestIds?: string[]; externalRequestId?: string },
  fallback: string[],
): string[] => {
  if (Array.isArray(data.linkedExternalRequestIds)) {
    return parseLinkedExternalRequestIds(data.linkedExternalRequestIds)
  }
  if (data.externalRequestId !== undefined) {
    const normalized = data.externalRequestId.trim()
    return normalized ? [normalized] : []
  }
  return fallback
}

const calculateFinancials = (params: FinancialParams) => {
  const partsCost = Number(
    params.linkedRequests.reduce((total, request) => total + toNonNegativeNumber(request.partsTotal, 0), 0).toFixed(2),
  )

  let laborCost = 0
  if (params.laborCostInput !== undefined) {
    laborCost = toNonNegativeNumber(params.laborCostInput, 0)
  } else if (params.realCostInput !== undefined) {
    const asRealCost = toNonNegativeNumber(params.realCostInput, 0)
    laborCost = params.linkedRequests.length > 0 ? Number(Math.max(0, asRealCost - partsCost).toFixed(2)) : asRealCost
  } else if (params.existingLaborCost !== undefined) {
    laborCost = toNonNegativeNumber(params.existingLaborCost, 0)
  } else if (params.existingRealCost !== undefined) {
    const existingRealCost = toNonNegativeNumber(params.existingRealCost, 0)
    const existingPartsCost = toNonNegativeNumber(params.existingPartsCost, 0)
    laborCost = Number(Math.max(0, existingRealCost - existingPartsCost).toFixed(2))
  }

  const realCost = Number((laborCost + partsCost).toFixed(2))
  const invoicedToClient =
    params.invoicedInput !== undefined
      ? toNonNegativeNumber(params.invoicedInput, 0)
      : params.existingInvoiced !== undefined
        ? toNonNegativeNumber(params.existingInvoiced, 0)
        : realCost
  const margin = Number((invoicedToClient - realCost).toFixed(2))

  return {
    laborCost,
    partsCost,
    realCost,
    invoicedToClient,
    margin,
  }
}

const mapRecoveryRepairToPublicShape = (row: RecoveryRepairRow) => ({
  id: row.id,
  unitId: row.unitId,
  workOrderId: row.workOrderId ?? '',
  externalRequestId: row.externalRequestId ?? undefined,
  linkedExternalRequestIds: parseLinkedExternalRequestIds(row.linkedExternalRequestIds),
  sourceType: row.sourceType === 'EXTERNAL_REQUEST' ? 'EXTERNAL_REQUEST' : 'WORK_ORDER',
  performedAt: asIsoString(row.performedAt) ?? asIsoString(row.createdAt),
  unitKilometers: Number.isFinite(row.unitKilometers ?? NaN) ? Number(row.unitKilometers) : 0,
  currency: row.currency === 'USD' ? 'USD' : 'ARS',
  supplierId: row.supplierId ?? undefined,
  supplierName: row.supplierName,
  laborCost: toNonNegativeNumber(row.laborCost, 0),
  partsCost: toNonNegativeNumber(row.partsCost, 0),
  createdAt: asIsoString(row.createdAt),
  realCost: row.realCost,
  invoicedToClient: row.invoicedToClient,
  margin: row.margin,
  invoiceFileName: row.invoiceFileName || undefined,
  invoiceFileBase64: row.invoiceFileBase64 || undefined,
  invoiceFileUrl: row.invoiceFileUrl || undefined,
})

const mergeRepairCollections = (primary: any[], secondary: any[]) => {
  const map = new Map<string, any>()
  const push = (item: any) => {
    if (!item?.id) return
    const prev = map.get(item.id)
    if (!prev) {
      map.set(item.id, item)
      return
    }
    const prevTime = new Date(prev.createdAt ?? 0).getTime()
    const nextTime = new Date(item.createdAt ?? 0).getTime()
    if (nextTime >= prevTime) {
      map.set(item.id, item)
    }
  }

  primary.forEach(push)
  secondary.forEach(push)

  return Array.from(map.values()).sort(
    (a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime(),
  )
}

const isSafeSqlIdentifier = (value: string) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)

const listRepairsFromRecoverySchemas = async (): Promise<ReturnType<typeof mapRecoveryRepairToPublicShape>[]> => {
  const schemaRows = await prisma.$queryRaw<{ schema_name: string }[]>`
    SELECT DISTINCT n.nspname AS schema_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'RepairRecord'
  `

  const targetSchemas = schemaRows
    .map((row) => row.schema_name)
    .filter((schema) => REPAIR_RECOVERY_SCHEMAS.includes(schema as (typeof REPAIR_RECOVERY_SCHEMAS)[number]))
  if (targetSchemas.length === 0) {
    const currentSchemaRows = await prisma.$queryRaw<{ schema_name: string }[]>`
      SELECT current_schema() AS schema_name
    `
    const currentSchema = currentSchemaRows[0]?.schema_name
    if (currentSchema && REPAIR_RECOVERY_SCHEMAS.includes(currentSchema as (typeof REPAIR_RECOVERY_SCHEMAS)[number])) {
      targetSchemas.push(currentSchema)
    }
  }

  const allRows: RecoveryRepairRow[] = []
  for (const schema of targetSchemas) {
    if (!isSafeSqlIdentifier(schema)) {
      continue
    }

    const columnRows = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = ${schema}
        AND table_name = 'RepairRecord'
    `
    const columns = new Set(columnRows.map((row) => row.column_name))
    const performedAtSelect = columns.has('performedAt') ? `"performedAt"` : `"createdAt" AS "performedAt"`
    const unitKilometersSelect = columns.has('unitKilometers') ? `"unitKilometers"` : `0 AS "unitKilometers"`
    const currencySelect = columns.has('currency') ? `"currency"::text` : `'ARS'::text AS "currency"`
    const externalRequestIdSelect = columns.has('externalRequestId')
      ? `"externalRequestId"`
      : `NULL::text AS "externalRequestId"`
    const sourceTypeSelect = columns.has('sourceType') ? `"sourceType"` : `'WORK_ORDER'::text AS "sourceType"`
    const supplierIdSelect = columns.has('supplierId') ? `"supplierId"` : `NULL::text AS "supplierId"`
    const linkedExternalRequestIdsSelect = columns.has('linkedExternalRequestIds')
      ? `"linkedExternalRequestIds"`
      : `'[]'::jsonb AS "linkedExternalRequestIds"`
    const laborCostSelect = columns.has('laborCost') ? `"laborCost"` : `"realCost" AS "laborCost"`
    const partsCostSelect = columns.has('partsCost') ? `"partsCost"` : `0 AS "partsCost"`
    const invoiceFileNameSelect = columns.has('invoiceFileName') ? `"invoiceFileName"` : `''::text AS "invoiceFileName"`
    const invoiceFileBase64Select = columns.has('invoiceFileBase64')
      ? `"invoiceFileBase64"`
      : `''::text AS "invoiceFileBase64"`
    const invoiceFileUrlSelect = columns.has('invoiceFileUrl') ? `"invoiceFileUrl"` : `''::text AS "invoiceFileUrl"`

    const query = `
      SELECT
        "id",
        "unitId",
        "workOrderId",
        ${externalRequestIdSelect},
        ${sourceTypeSelect},
        ${supplierIdSelect},
        "supplierName",
        ${linkedExternalRequestIdsSelect},
        ${laborCostSelect},
        ${partsCostSelect},
        "realCost",
        "invoicedToClient",
        "margin",
        ${invoiceFileNameSelect},
        ${invoiceFileBase64Select},
        ${invoiceFileUrlSelect},
        "createdAt",
        "updatedAt",
        ${performedAtSelect},
        ${unitKilometersSelect},
        ${currencySelect}
      FROM "${schema}"."RepairRecord"
      ORDER BY "createdAt" DESC
    `

    const rows = await prisma.$queryRawUnsafe<RecoveryRepairRow[]>(query)
    allRows.push(...rows)
  }

  const mapped = allRows.map(mapRecoveryRepairToPublicShape)
  return mergeRepairCollections(mapped, [])
}

const supportsRepairOperationalColumns = async (): Promise<boolean> => {
  const now = Date.now()
  if (repairColumnsSupportCache && now - repairColumnsSupportCache.checkedAt < REPAIR_COLUMNS_CACHE_MS) {
    return repairColumnsSupportCache.supported
  }

  try {
    const rows = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'RepairRecord'
        AND column_name IN (
          ${REPAIR_OPERATIONAL_COLUMNS[0]},
          ${REPAIR_OPERATIONAL_COLUMNS[1]},
          ${REPAIR_OPERATIONAL_COLUMNS[2]},
          ${REPAIR_OPERATIONAL_COLUMNS[3]},
          ${REPAIR_OPERATIONAL_COLUMNS[4]},
          ${REPAIR_OPERATIONAL_COLUMNS[5]}
        )
    `
    const found = new Set(rows.map((row) => row.column_name))
    const supported = REPAIR_OPERATIONAL_COLUMNS.every((columnName) => found.has(columnName))
    repairColumnsSupportCache = { checkedAt: now, supported }
    return supported
  } catch {
    return true
  }
}

const mapLegacyRepairToPublicShape = (row: LegacyRepairRow) => ({
  id: row.id,
  unitId: row.unitId,
  workOrderId: row.workOrderId ?? '',
  externalRequestId: row.externalRequestId ?? undefined,
  linkedExternalRequestIds: row.externalRequestId ? [row.externalRequestId] : [],
  sourceType: row.sourceType === 'EXTERNAL_REQUEST' ? 'EXTERNAL_REQUEST' : 'WORK_ORDER',
  performedAt: row.createdAt.toISOString(),
  unitKilometers: 0,
  currency: 'ARS' as const,
  supplierName: row.supplierName,
  laborCost: row.realCost,
  partsCost: 0,
  createdAt: row.createdAt.toISOString(),
  realCost: row.realCost,
  invoicedToClient: row.invoicedToClient,
  margin: row.margin,
  invoiceFileName: row.invoiceFileName || undefined,
  invoiceFileBase64: row.invoiceFileBase64 || undefined,
  invoiceFileUrl: row.invoiceFileUrl || undefined,
})

const getLegacyRepairById = async (id: string): Promise<LegacyRepairRow | null> => {
  const rows = await prisma.$queryRaw<LegacyRepairRow[]>`
    SELECT
      "id",
      "unitId",
      "workOrderId",
      "externalRequestId",
      "sourceType",
      "supplierName",
      "realCost",
      "invoicedToClient",
      "margin",
      "invoiceFileName",
      "invoiceFileBase64",
      "invoiceFileUrl",
      "createdAt",
      "updatedAt"
    FROM "RepairRecord"
    WHERE "id" = ${id}
    LIMIT 1
  `
  return rows[0] ?? null
}

const createLegacyRepair = async (input: RepairInput) => {
  const id = input.id ?? createId()
  const rows = await prisma.$queryRaw<LegacyRepairRow[]>`
    INSERT INTO "RepairRecord" (
      "id",
      "unitId",
      "workOrderId",
      "externalRequestId",
      "sourceType",
      "supplierName",
      "realCost",
      "invoicedToClient",
      "margin",
      "invoiceFileName",
      "invoiceFileBase64",
      "invoiceFileUrl",
      "createdAt",
      "updatedAt"
    ) VALUES (
      ${id},
      ${input.unitId},
      ${input.workOrderId || null},
      ${input.externalRequestId || null},
      ${input.sourceType ?? 'WORK_ORDER'},
      ${input.supplierName},
      ${input.realCost ?? 0},
      ${input.invoicedToClient},
      ${input.margin ?? 0},
      ${input.invoiceFileName ?? ''},
      ${input.invoiceFileBase64 ?? ''},
      ${input.invoiceFileUrl ?? ''},
      NOW(),
      NOW()
    )
    RETURNING
      "id",
      "unitId",
      "workOrderId",
      "externalRequestId",
      "sourceType",
      "supplierName",
      "realCost",
      "invoicedToClient",
      "margin",
      "invoiceFileName",
      "invoiceFileBase64",
      "invoiceFileUrl",
      "createdAt",
      "updatedAt"
  `
  const row = rows[0]
  if (!row) {
    throw new Error('No se pudo crear la reparacion en modo compatibilidad.')
  }
  return mapLegacyRepairToPublicShape(row)
}

const fetchAndValidateLinkedExternalRequests = async (
  ids: string[],
  currency: (typeof CURRENCY_CODES)[number],
  currentRepairId?: string,
) => {
  if (ids.length === 0) {
    return [] as ExternalRequestLinkRow[]
  }

  const requests = await runWithSchemaFailover(() =>
    prisma.externalRequest.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        unitId: true,
        code: true,
        currency: true,
        partsTotal: true,
        eligibilityStatus: true,
        providerFileUrl: true,
        linkedRepairId: true,
      },
    }),
  )

  if (requests.length !== ids.length) {
    throw new RepairRequestError('Una o mas NDP seleccionadas no existen.', 400, 'EXTERNAL_REQUEST_NOT_FOUND')
  }

  const requestMap = new Map(requests.map((request) => [request.id, request]))
  const orderedRequests = ids.map((id) => requestMap.get(id)).filter(Boolean) as ExternalRequestLinkRow[]

  orderedRequests.forEach((request) => {
    const hasAttachment = Boolean((request.providerFileUrl ?? '').trim())
    const isReady = request.eligibilityStatus === 'READY_FOR_REPAIR'
    if (!hasAttachment || !isReady) {
      throw new RepairRequestError(
        `La NDP ${request.code} no es elegible. Debe tener adjunto y estado "Lista para reparacion".`,
        409,
        'EXTERNAL_REQUEST_NOT_ELIGIBLE',
      )
    }

    if (request.linkedRepairId && request.linkedRepairId !== currentRepairId) {
      throw new RepairRequestError(
        `La NDP ${request.code} ya esta vinculada a otra reparacion.`,
        409,
        'EXTERNAL_REQUEST_ALREADY_LINKED',
      )
    }

    if (normalizeCurrency(request.currency) !== currency) {
      throw new RepairRequestError(
        `La NDP ${request.code} tiene moneda distinta. Todas deben ser ${currency}.`,
        409,
        'EXTERNAL_REQUEST_CURRENCY_MISMATCH',
      )
    }
  })

  const unitIds = new Set(orderedRequests.map((request) => request.unitId))
  if (unitIds.size > 1) {
    throw new RepairRequestError('No se pueden mezclar NDP de distintas unidades en una misma reparacion.', 409, 'MIXED_UNIT')
  }

  return orderedRequests
}

router.get('/', async (_req, res) => {
  const supportsOperational = await supportsRepairOperationalColumns()
  const recoveryPromise = listRepairsFromRecoverySchemas().catch((error) => {
    console.error('Repairs recovery read error:', error)
    return []
  })

  try {
    if (supportsOperational) {
      const items = await runWithSchemaFailover(() => prisma.repairRecord.findMany({ orderBy: { createdAt: 'desc' } }))
      const recovered = await recoveryPromise
      return res.json(mergeRepairCollections(items, recovered))
    }
    return res.json(await recoveryPromise)
  } catch (error) {
    if (!supportsOperational || isMissingOperationalColumnError(error)) {
      return res.json(await recoveryPromise)
    }
    console.error('Repairs GET error:', error)
    const recovered = await recoveryPromise
    if (recovered.length > 0) {
      return res.json(recovered)
    }
    return res.status(500).json({ message: 'No se pudieron cargar las reparaciones.' })
  }
})

router.post('/', async (req: AuthenticatedRequest, res) => {
  const parsed = repairSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
  }

  try {
    const supportsOperational = await supportsRepairOperationalColumns()
    const linkedExternalRequestIds = resolveLinkedExternalRequestIds(parsed.data, [])
    const inferredSourceType =
      parsed.data.sourceType ?? (linkedExternalRequestIds.length > 0 || parsed.data.externalRequestId ? 'EXTERNAL_REQUEST' : 'WORK_ORDER')
    const sourceType = linkedExternalRequestIds.length > 0 ? 'EXTERNAL_REQUEST' : inferredSourceType

    if (sourceType === 'WORK_ORDER' && !parsed.data.workOrderId) {
      throw new RepairRequestError('Debes seleccionar una OT.', 400, 'WORK_ORDER_REQUIRED')
    }
    if (sourceType === 'EXTERNAL_REQUEST' && linkedExternalRequestIds.length === 0) {
      throw new RepairRequestError('Debes seleccionar al menos una NDP elegible.', 400, 'EXTERNAL_REQUEST_REQUIRED')
    }

    const linkedSupplier = parsed.data.supplierId
      ? await runWithSchemaFailover(() =>
          prisma.supplier.findUnique({
            where: { id: parsed.data.supplierId },
            select: { id: true, name: true },
          }),
        )
      : null
    if (parsed.data.supplierId && !linkedSupplier) {
      throw new RepairRequestError('Proveedor no encontrado.', 400, 'SUPPLIER_NOT_FOUND')
    }
    const normalizedSupplierName = linkedSupplier?.name ?? parsed.data.supplierName.trim()

    const inferredCurrency =
      parsed.data.currency ??
      (linkedExternalRequestIds.length > 0
        ? normalizeCurrency(
            (
              await runWithSchemaFailover(() =>
                prisma.externalRequest.findUnique({
                  where: { id: linkedExternalRequestIds[0] },
                  select: { currency: true },
                }),
              )
            )?.currency,
          )
        : 'ARS')
    const currency = normalizeCurrency(inferredCurrency)
    const linkedRequests = await fetchAndValidateLinkedExternalRequests(linkedExternalRequestIds, currency)

    const financials = calculateFinancials({
      linkedRequests,
      laborCostInput: parsed.data.laborCost,
      realCostInput: parsed.data.realCost,
      invoicedInput: parsed.data.invoicedToClient,
    })

    const resolvedUnitId = linkedRequests[0]?.unitId ?? parsed.data.unitId

    if (supportsOperational) {
      const item = await runWithSchemaFailover(() =>
        prisma.$transaction(async (tx) => {
          const created = await tx.repairRecord.create({
            data: {
              id: parsed.data.id,
              unitId: resolvedUnitId,
              sourceType,
              workOrderId: sourceType === 'WORK_ORDER' ? parsed.data.workOrderId || null : null,
              externalRequestId: linkedExternalRequestIds[0] ?? null,
              linkedExternalRequestIds: linkedExternalRequestIds as any,
              supplierId: linkedSupplier?.id ?? null,
              performedAt: parsed.data.performedAt ?? new Date().toISOString(),
              unitKilometers: parsed.data.unitKilometers ?? 0,
              currency,
              supplierName: normalizedSupplierName,
              laborCost: financials.laborCost,
              partsCost: financials.partsCost,
              realCost: financials.realCost,
              invoicedToClient: financials.invoicedToClient,
              margin: financials.margin,
              invoiceFileName: parsed.data.invoiceFileName ?? '',
              invoiceFileBase64: parsed.data.invoiceFileBase64 ?? '',
              invoiceFileUrl: parsed.data.invoiceFileUrl ?? '',
            },
          })

          if (linkedExternalRequestIds.length > 0) {
            await tx.externalRequest.updateMany({
              where: { id: { in: linkedExternalRequestIds } },
              data: { linkedRepairId: created.id },
            })
          }

          return created
        }),
      )

      const [actor, workOrder] = await Promise.all([
        req.userId
          ? prisma.user.findUnique({ where: { id: req.userId }, select: { fullName: true } })
          : Promise.resolve(null),
        item.workOrderId
          ? prisma.workOrder.findUnique({ where: { id: item.workOrderId }, select: { code: true } })
          : Promise.resolve(null),
      ])

      const externalLabel =
        linkedRequests.length > 1
          ? `${linkedRequests[0]?.code} +${linkedRequests.length - 1}`
          : linkedRequests[0]?.code ?? 'sin origen'
      const sourceLabel = sourceType === 'WORK_ORDER' ? (workOrder?.code ?? 'sin OT') : externalLabel

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
    }

    if (linkedExternalRequestIds.length > 1 || parsed.data.laborCost !== undefined || parsed.data.partsCost !== undefined) {
      throw new RepairRequestError(
        'La base no soporta aun vinculacion multiple de NDP. Ejecuta migraciones y reinicia el backend.',
        409,
        'LEGACY_SCHEMA_LIMIT',
      )
    }

    const legacyItem = await createLegacyRepair({
      ...parsed.data,
      unitId: resolvedUnitId,
      sourceType,
      externalRequestId: linkedExternalRequestIds[0] ?? parsed.data.externalRequestId,
      supplierId: linkedSupplier?.id ?? undefined,
      supplierName: normalizedSupplierName,
      realCost: financials.realCost,
      margin: financials.margin,
      invoicedToClient: financials.invoicedToClient,
    })

    return res.status(201).json(legacyItem)
  } catch (error: unknown) {
    if (error instanceof RepairRequestError) {
      return res.status(error.status).json({ message: error.message })
    }
    if (getErrorCode(error) === 'P2002') {
      return res.status(409).json({ message: 'Registro duplicado.' })
    }
    if (isMissingOperationalColumnError(error)) {
      try {
        const fallbackItem = await createLegacyRepair(parsed.data)
        return res.status(201).json(fallbackItem)
      } catch (fallbackError) {
        console.error('Repairs POST fallback error:', fallbackError)
      }
    }
    console.error('Repairs POST error:', error)
    return res.status(500).json({ message: 'No se pudo crear la reparacion.' })
  }
})

router.patch('/:id', async (req, res) => {
  const parsed = repairUpdateSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
  }

  const repairId = req.params.id
  if (!repairId) {
    return res.status(400).json({ message: 'Id de reparacion requerido.' })
  }

  const supportsOperational = await supportsRepairOperationalColumns()
  try {
    if (supportsOperational) {
      const existing = await runWithSchemaFailover(() => prisma.repairRecord.findUnique({ where: { id: repairId } }))
      if (!existing) {
        return res.status(404).json({ message: 'Reparacion no encontrada.' })
      }

      const existingLinkedIds = parseLinkedExternalRequestIds((existing as any).linkedExternalRequestIds)
      const nextLinkedIds = resolveLinkedExternalRequestIds(parsed.data, existingLinkedIds)
      const requestedSourceType = parsed.data.sourceType ?? existing.sourceType ?? 'WORK_ORDER'
      const sourceType = nextLinkedIds.length > 0 ? 'EXTERNAL_REQUEST' : requestedSourceType

      if (sourceType === 'WORK_ORDER' && !(parsed.data.workOrderId ?? existing.workOrderId)) {
        throw new RepairRequestError('Debes seleccionar una OT.', 400, 'WORK_ORDER_REQUIRED')
      }
      if (sourceType === 'EXTERNAL_REQUEST' && nextLinkedIds.length === 0) {
        throw new RepairRequestError('Debes seleccionar al menos una NDP elegible.', 400, 'EXTERNAL_REQUEST_REQUIRED')
      }

      const linkedSupplier = parsed.data.supplierId
        ? await runWithSchemaFailover(() =>
            prisma.supplier.findUnique({
              where: { id: parsed.data.supplierId },
              select: { id: true, name: true },
            }),
          )
        : null
      if (parsed.data.supplierId && !linkedSupplier) {
        throw new RepairRequestError('Proveedor no encontrado.', 400, 'SUPPLIER_NOT_FOUND')
      }

      const inferredCurrency = normalizeCurrency(
        parsed.data.currency ??
          (nextLinkedIds.length > 0
            ? (
                await runWithSchemaFailover(() =>
                  prisma.externalRequest.findUnique({
                    where: { id: nextLinkedIds[0] },
                    select: { currency: true },
                  }),
                )
              )?.currency
            : existing.currency),
      )

      const linkedRequests = await fetchAndValidateLinkedExternalRequests(nextLinkedIds, inferredCurrency, repairId)
      const linkedUnitId = linkedRequests[0]?.unitId
      const unitId = linkedUnitId ?? parsed.data.unitId ?? existing.unitId

      const financials = calculateFinancials({
        linkedRequests,
        laborCostInput: parsed.data.laborCost,
        realCostInput: parsed.data.realCost,
        existingLaborCost: (existing as any).laborCost,
        existingPartsCost: (existing as any).partsCost,
        existingRealCost: existing.realCost,
        invoicedInput: parsed.data.invoicedToClient,
        existingInvoiced: existing.invoicedToClient,
      })

      const nextSupplierName = (linkedSupplier?.name ?? parsed.data.supplierName ?? existing.supplierName).trim()
      const nextSupplierId =
        parsed.data.supplierId !== undefined
          ? linkedSupplier?.id ?? null
          : parsed.data.supplierName !== undefined
            ? null
            : existing.supplierId

      const removedLinkedIds = existingLinkedIds.filter((id) => !nextLinkedIds.includes(id))
      const addedLinkedIds = nextLinkedIds.filter((id) => !existingLinkedIds.includes(id))

      const updated = await runWithSchemaFailover(() =>
        prisma.$transaction(async (tx) => {
          if (removedLinkedIds.length > 0) {
            await tx.externalRequest.updateMany({
              where: {
                id: { in: removedLinkedIds },
                linkedRepairId: repairId,
              },
              data: { linkedRepairId: null },
            })
          }

          if (addedLinkedIds.length > 0) {
            await tx.externalRequest.updateMany({
              where: { id: { in: addedLinkedIds } },
              data: { linkedRepairId: repairId },
            })
          }

          return tx.repairRecord.update({
            where: { id: repairId },
            data: {
              unitId,
              sourceType,
              workOrderId:
                sourceType === 'WORK_ORDER'
                  ? parsed.data.workOrderId !== undefined
                    ? parsed.data.workOrderId || null
                    : existing.workOrderId
                  : null,
              externalRequestId: nextLinkedIds[0] ?? null,
              linkedExternalRequestIds: nextLinkedIds as any,
              supplierId: nextSupplierId,
              supplierName: nextSupplierName,
              performedAt: parsed.data.performedAt ?? existing.performedAt,
              unitKilometers:
                typeof parsed.data.unitKilometers === 'number'
                  ? Math.max(0, Math.trunc(parsed.data.unitKilometers))
                  : existing.unitKilometers,
              currency: inferredCurrency,
              laborCost: financials.laborCost,
              partsCost: financials.partsCost,
              realCost: financials.realCost,
              invoicedToClient: financials.invoicedToClient,
              margin: financials.margin,
              invoiceFileName:
                parsed.data.invoiceFileName !== undefined ? parsed.data.invoiceFileName : existing.invoiceFileName,
              invoiceFileBase64:
                parsed.data.invoiceFileBase64 !== undefined ? parsed.data.invoiceFileBase64 : existing.invoiceFileBase64,
              invoiceFileUrl:
                parsed.data.invoiceFileUrl !== undefined ? parsed.data.invoiceFileUrl : existing.invoiceFileUrl,
            },
          })
        }),
      )

      return res.json(updated)
    }

    const existing = await getLegacyRepairById(repairId)
    if (!existing) {
      return res.status(404).json({ message: 'Reparacion no encontrada.' })
    }

    const nextLinkedIds = resolveLinkedExternalRequestIds(parsed.data, existing.externalRequestId ? [existing.externalRequestId] : [])
    if (nextLinkedIds.length > 1 || parsed.data.laborCost !== undefined || parsed.data.partsCost !== undefined) {
      throw new RepairRequestError(
        'La base no soporta aun vinculacion multiple de NDP. Ejecuta migraciones y reinicia el backend.',
        409,
        'LEGACY_SCHEMA_LIMIT',
      )
    }

    const linkedSupplier = parsed.data.supplierId
      ? await prisma.supplier.findUnique({
          where: { id: parsed.data.supplierId },
          select: { id: true, name: true },
        })
      : null
    if (parsed.data.supplierId && !linkedSupplier) {
      throw new RepairRequestError('Proveedor no encontrado.', 400, 'SUPPLIER_NOT_FOUND')
    }

    const workOrderId =
      parsed.data.workOrderId !== undefined ? (parsed.data.workOrderId || null) : existing.workOrderId
    const externalRequestId = nextLinkedIds[0] ?? null
    const sourceType = nextLinkedIds.length > 0 ? 'EXTERNAL_REQUEST' : (parsed.data.sourceType ?? existing.sourceType ?? 'WORK_ORDER')
    const supplierName = linkedSupplier?.name ?? parsed.data.supplierName ?? existing.supplierName

    const financials = calculateFinancials({
      linkedRequests: [],
      laborCostInput: parsed.data.laborCost,
      realCostInput: parsed.data.realCost,
      existingRealCost: existing.realCost,
      existingInvoiced: existing.invoicedToClient,
      invoicedInput: parsed.data.invoicedToClient,
    })

    const invoiceFileName = parsed.data.invoiceFileName ?? existing.invoiceFileName
    const invoiceFileBase64 = parsed.data.invoiceFileBase64 ?? existing.invoiceFileBase64
    const invoiceFileUrl = parsed.data.invoiceFileUrl ?? existing.invoiceFileUrl

    const rows = await prisma.$queryRaw<LegacyRepairRow[]>`
      UPDATE "RepairRecord"
      SET
        "unitId" = ${parsed.data.unitId ?? existing.unitId},
        "workOrderId" = ${workOrderId},
        "externalRequestId" = ${externalRequestId},
        "sourceType" = ${sourceType},
        "supplierName" = ${supplierName},
        "realCost" = ${financials.realCost},
        "invoicedToClient" = ${financials.invoicedToClient},
        "margin" = ${financials.margin},
        "invoiceFileName" = ${invoiceFileName ?? ''},
        "invoiceFileBase64" = ${invoiceFileBase64 ?? ''},
        "invoiceFileUrl" = ${invoiceFileUrl ?? ''},
        "updatedAt" = NOW()
      WHERE "id" = ${repairId}
      RETURNING
        "id",
        "unitId",
        "workOrderId",
        "externalRequestId",
        "sourceType",
        "supplierName",
        "realCost",
        "invoicedToClient",
        "margin",
        "invoiceFileName",
        "invoiceFileBase64",
        "invoiceFileUrl",
        "createdAt",
        "updatedAt"
    `
    const updated = rows[0]
    if (!updated) {
      return res.status(404).json({ message: 'Reparacion no encontrada.' })
    }
    return res.json(mapLegacyRepairToPublicShape(updated))
  } catch (error) {
    if (error instanceof RepairRequestError) {
      return res.status(error.status).json({ message: error.message })
    }
    console.error('Repairs PATCH error:', error)
    return res.status(500).json({ message: 'No se pudo actualizar la reparacion.' })
  }
})

router.delete('/:id', async (req, res) => {
  const repairId = req.params.id
  if (!repairId) {
    return res.status(400).json({ message: 'Id de reparacion requerido.' })
  }

  try {
    const supportsOperational = await supportsRepairOperationalColumns()
    if (!supportsOperational) {
      await prisma.repairRecord.delete({ where: { id: repairId } })
      return res.status(204).send()
    }

    await runWithSchemaFailover(() =>
      prisma.$transaction(async (tx) => {
        const repair = await tx.repairRecord.findUnique({
          where: { id: repairId },
          select: { id: true, linkedExternalRequestIds: true },
        })
        if (!repair) {
          throw new RepairRequestError('Reparacion no encontrada.', 404, 'REPAIR_NOT_FOUND')
        }

        const linkedIds = parseLinkedExternalRequestIds((repair as any).linkedExternalRequestIds)
        if (linkedIds.length > 0) {
          await tx.externalRequest.updateMany({
            where: {
              id: { in: linkedIds },
              linkedRepairId: repairId,
            },
            data: { linkedRepairId: null },
          })
        }

        await tx.repairRecord.delete({ where: { id: repairId } })
      }),
    )

    return res.status(204).send()
  } catch (error) {
    if (error instanceof RepairRequestError) {
      return res.status(error.status).json({ message: error.message })
    }
    return res.status(500).json({ message: 'No se pudo eliminar la reparacion.' })
  }
})

export default router
