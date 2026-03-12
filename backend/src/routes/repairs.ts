import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db.js'
import type { AuthenticatedRequest } from '../middleware/auth.js'
import { pushUserNotifications, resolveOperationalNotificationRecipients } from '../services/userNotifications.js'

const router = Router()

const REPAIR_OPERATIONAL_COLUMNS = ['performedAt', 'unitKilometers', 'currency'] as const
const REPAIR_COLUMNS_CACHE_MS = 5 * 60 * 1000

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
  supplierName: string
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

const mapRecoveryRepairToPublicShape = (row: RecoveryRepairRow) => ({
  id: row.id,
  unitId: row.unitId,
  workOrderId: row.workOrderId ?? '',
  externalRequestId: row.externalRequestId ?? undefined,
  sourceType: row.sourceType === 'EXTERNAL_REQUEST' ? 'EXTERNAL_REQUEST' : 'WORK_ORDER',
  performedAt: asIsoString(row.performedAt) ?? asIsoString(row.createdAt),
  unitKilometers: Number.isFinite(row.unitKilometers ?? NaN) ? Number(row.unitKilometers) : 0,
  currency: row.currency === 'USD' ? 'USD' : 'ARS',
  supplierName: row.supplierName,
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
        "supplierName",
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
        AND column_name IN (${REPAIR_OPERATIONAL_COLUMNS[0]}, ${REPAIR_OPERATIONAL_COLUMNS[1]}, ${REPAIR_OPERATIONAL_COLUMNS[2]})
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
  sourceType: row.sourceType === 'EXTERNAL_REQUEST' ? 'EXTERNAL_REQUEST' : 'WORK_ORDER',
  performedAt: row.createdAt.toISOString(),
  unitKilometers: 0,
  currency: 'ARS' as const,
  supplierName: row.supplierName,
  createdAt: row.createdAt.toISOString(),
  realCost: row.realCost,
  invoicedToClient: row.invoicedToClient,
  margin: row.margin,
  invoiceFileName: row.invoiceFileName || undefined,
  invoiceFileBase64: row.invoiceFileBase64 || undefined,
  invoiceFileUrl: row.invoiceFileUrl || undefined,
})

const listLegacyRepairs = async () => {
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
    ORDER BY "createdAt" DESC
  `
  return rows.map(mapLegacyRepairToPublicShape)
}

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
      ${input.realCost},
      ${input.invoicedToClient},
      ${input.margin},
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

router.get('/', async (_req, res) => {
  const supportsOperational = await supportsRepairOperationalColumns()
  const recoveryPromise = listRepairsFromRecoverySchemas().catch((error) => {
    console.error('Repairs recovery read error:', error)
    return []
  })

  try {
    if (supportsOperational) {
      const items = await prisma.repairRecord.findMany({ orderBy: { createdAt: 'desc' } })
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
    if (parsed.data.sourceType === 'WORK_ORDER' && !parsed.data.workOrderId) {
      return res.status(400).json({ message: 'Debes seleccionar una OT.' })
    }
    if (parsed.data.sourceType === 'EXTERNAL_REQUEST' && !parsed.data.externalRequestId) {
      return res.status(400).json({ message: 'Debes seleccionar una nota externa.' })
    }

    const supportsOperational = await supportsRepairOperationalColumns()
    const item = supportsOperational
      ? await prisma.repairRecord.create({
          data: {
            ...parsed.data,
            performedAt: parsed.data.performedAt ?? new Date().toISOString(),
            unitKilometers: parsed.data.unitKilometers ?? 0,
            currency: parsed.data.currency ?? 'ARS',
          },
        })
      : await createLegacyRepair(parsed.data)

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
      const item = await prisma.repairRecord.update({
        where: { id: repairId },
        data: {
          ...parsed.data,
          unitKilometers:
            typeof parsed.data.unitKilometers === 'number'
              ? Math.max(0, Math.trunc(parsed.data.unitKilometers))
              : parsed.data.unitKilometers,
        },
      })
      return res.json(item)
    }

    const existing = await getLegacyRepairById(repairId)
    if (!existing) {
      return res.status(404).json({ message: 'Reparacion no encontrada.' })
    }

    const workOrderId =
      parsed.data.workOrderId !== undefined ? (parsed.data.workOrderId || null) : existing.workOrderId
    const externalRequestId =
      parsed.data.externalRequestId !== undefined ? (parsed.data.externalRequestId || null) : existing.externalRequestId
    const sourceType = parsed.data.sourceType ?? existing.sourceType ?? 'WORK_ORDER'
    const supplierName = parsed.data.supplierName ?? existing.supplierName
    const realCost = parsed.data.realCost ?? existing.realCost
    const invoicedToClient = parsed.data.invoicedToClient ?? existing.invoicedToClient
    const margin = parsed.data.margin ?? existing.margin
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
        "realCost" = ${realCost},
        "invoicedToClient" = ${invoicedToClient},
        "margin" = ${margin},
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
    console.error('Repairs PATCH error:', error)
    return res.status(500).json({ message: 'No se pudo actualizar la reparacion.' })
  }
})

router.delete('/:id', async (req, res) => {
  await prisma.repairRecord.delete({ where: { id: req.params.id } })
  return res.status(204).send()
})

export default router
