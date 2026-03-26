import { Router } from 'express'
import { z } from 'zod'
import { prisma, runWithSchemaFailover } from '../db.js'
import type { AuthenticatedRequest } from '../middleware/auth.js'
import { pushUserNotifications, resolveOperationalNotificationRecipients } from '../services/userNotifications.js'

const router = Router()

const CURRENCY_VALUES = ['ARS', 'USD'] as const
const ELIGIBILITY_VALUES = ['PENDING_ATTACHMENT', 'READY_FOR_REPAIR'] as const
const EXTERNAL_REQUEST_RECOVERY_SCHEMAS = ['enertrans_prod', 'public'] as const

const externalRequestPartItemSchema = z.object({
  description: z.string().min(1).max(240),
  quantity: z.number().positive(),
  unitPrice: z.number().min(0),
  lineTotal: z.number().min(0).optional(),
})

const externalRequestSchema = z.object({
  id: z.string().min(1).optional(),
  code: z.string().min(1),
  unitId: z.string().min(1),
  companyName: z.string().min(1),
  description: z.string().min(1),
  tasks: z.array(z.string().min(1)),
  currency: z.enum(CURRENCY_VALUES).optional(),
  partsItems: z.array(externalRequestPartItemSchema).optional(),
  partsTotal: z.number().min(0).optional(),
  eligibilityStatus: z.enum(ELIGIBILITY_VALUES).optional(),
  linkedRepairId: z.string().optional().nullable(),
  providerFileName: z.string().optional(),
  providerFileUrl: z.string().optional(),
  createdAt: z.string().optional(),
})

const externalRequestUpdateSchema = externalRequestSchema.partial()

type ExternalRequestInput = z.infer<typeof externalRequestSchema>
type ExternalRequestUpdateInput = z.infer<typeof externalRequestUpdateSchema>
type ExternalRequestPartItem = {
  description: string
  quantity: number
  unitPrice: number
  lineTotal: number
}
type RecoveryExternalRequestRow = {
  id: string
  code: string
  unitId: string
  companyName: string | null
  description: string | null
  tasks: unknown
  currency: string | null
  partsItems: unknown
  partsTotal: number | null
  eligibilityStatus: string | null
  linkedRepairId: string | null
  providerFileName: string | null
  providerFileUrl: string | null
  createdAt: Date | string
  updatedAt: Date | string
}

const normalizeCurrency = (value: unknown): (typeof CURRENCY_VALUES)[number] => {
  return value === 'USD' ? 'USD' : 'ARS'
}

const normalizeTasks = (tasks: string[]): string[] => {
  const next = tasks.map((item) => item.trim()).filter(Boolean)
  return next.length > 0 ? next : ['Sin detalle']
}

const normalizePartItems = (rawItems: unknown): ExternalRequestPartItem[] => {
  if (!Array.isArray(rawItems)) {
    return []
  }
  return rawItems
    .map((raw) => {
      const parsed = externalRequestPartItemSchema.safeParse(raw)
      if (!parsed.success) {
        return null
      }
      const description = parsed.data.description.trim()
      const quantity = Number(parsed.data.quantity)
      const unitPrice = Number(parsed.data.unitPrice)
      if (!description || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0) {
        return null
      }
      const lineTotal = Number((quantity * unitPrice).toFixed(2))
      return {
        description,
        quantity: Number(quantity.toFixed(2)),
        unitPrice: Number(unitPrice.toFixed(2)),
        lineTotal,
      }
    })
    .filter((item): item is ExternalRequestPartItem => Boolean(item))
}

const calculatePartsTotal = (items: ExternalRequestPartItem[]): number =>
  Number(items.reduce((total, item) => total + item.lineTotal, 0).toFixed(2))

const resolveEligibilityStatus = (providerFileUrl: string): (typeof ELIGIBILITY_VALUES)[number] =>
  providerFileUrl.trim() ? 'READY_FOR_REPAIR' : 'PENDING_ATTACHMENT'

const isSafeSqlIdentifier = (value: string) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)

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

const toStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? '').trim()).filter(Boolean)
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) {
      return []
    }
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item ?? '').trim()).filter(Boolean)
      }
    } catch {
      // El valor ya viene como string simple legacy.
    }
    return [trimmed]
  }
  return []
}

const parseJsonUnknown = (value: unknown): unknown => {
  if (typeof value !== 'string') {
    return value
  }
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }
  try {
    return JSON.parse(trimmed)
  } catch {
    return value
  }
}

const mapRecoveryExternalRequestToPublicShape = (row: RecoveryExternalRequestRow) => ({
  id: row.id,
  code: row.code,
  unitId: row.unitId,
  companyName: String(row.companyName ?? '').trim(),
  description: String(row.description ?? '').trim(),
  tasks: toStringArray(parseJsonUnknown(row.tasks)),
  currency: normalizeCurrency(row.currency),
  partsItems: normalizePartItems(parseJsonUnknown(row.partsItems)),
  partsTotal: Number.isFinite(row.partsTotal ?? NaN) ? Number(row.partsTotal) : 0,
  eligibilityStatus:
    row.eligibilityStatus === 'READY_FOR_REPAIR' ? ('READY_FOR_REPAIR' as const) : ('PENDING_ATTACHMENT' as const),
  linkedRepairId: row.linkedRepairId ?? null,
  providerFileName: row.providerFileName ?? '',
  providerFileUrl: row.providerFileUrl ?? '',
  createdAt: asIsoString(row.createdAt),
  updatedAt: asIsoString(row.updatedAt),
})

const mergeExternalRequests = (primary: any[], secondary: any[]) => {
  const map = new Map<string, any>()
  const push = (item: any) => {
    if (!item?.id) {
      return
    }
    const previous = map.get(item.id)
    if (!previous) {
      map.set(item.id, item)
      return
    }
    const previousTime = new Date(previous.updatedAt ?? previous.createdAt ?? 0).getTime()
    const nextTime = new Date(item.updatedAt ?? item.createdAt ?? 0).getTime()
    if (nextTime >= previousTime) {
      map.set(item.id, item)
    }
  }

  primary.forEach(push)
  secondary.forEach(push)

  return Array.from(map.values()).sort(
    (a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime(),
  )
}

const listExternalRequestsFromRecoverySchemas = async () => {
  const schemaRows = await prisma.$queryRaw<{ schema_name: string }[]>`
    SELECT DISTINCT n.nspname AS schema_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'ExternalRequest'
  `

  const targetSchemas = schemaRows
    .map((row) => row.schema_name)
    .filter((schema) => EXTERNAL_REQUEST_RECOVERY_SCHEMAS.includes(schema as (typeof EXTERNAL_REQUEST_RECOVERY_SCHEMAS)[number]))

  const allRows: RecoveryExternalRequestRow[] = []

  for (const schema of targetSchemas) {
    if (!isSafeSqlIdentifier(schema)) {
      continue
    }

    try {
      const columnRows = await prisma.$queryRaw<{ column_name: string }[]>`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = ${schema}
          AND table_name = 'ExternalRequest'
      `
      const columns = new Set(columnRows.map((row) => row.column_name))

      const requiredColumns = ['id', 'code', 'unitId']
      if (requiredColumns.some((column) => !columns.has(column))) {
        continue
      }

      const quoteColumn = (column: string): string => `"${column.replace(/"/g, '""')}"`
      const findColumn = (candidates: string[]): string | null => candidates.find((column) => columns.has(column)) ?? null
      const asTextSelect = (column: string, alias: string): string => `${quoteColumn(column)}::text AS "${alias}"`
      const textSelectOrDefault = (candidates: string[], alias: string, fallback = "''::text"): string => {
        const column = findColumn(candidates)
        return column ? asTextSelect(column, alias) : `${fallback} AS "${alias}"`
      }

      const createdAtColumn = findColumn(['createdAt']) ?? null
      if (!createdAtColumn) {
        continue
      }
      const updatedAtColumn = findColumn(['updatedAt'])
      const tasksColumn = findColumn(['tasks'])
      const providerFileUrlColumn = findColumn(['providerFileUrl'])

      const companyNameSelect = textSelectOrDefault(
        ['companyName', 'company', 'supplierName', 'providerName'],
        'companyName',
      )
      const descriptionSelect = textSelectOrDefault(['description', 'details', 'summary'], 'description')
      const tasksSelect = tasksColumn ? `${quoteColumn(tasksColumn)} AS "tasks"` : `'[]'::jsonb AS "tasks"`
      const currencySelect = textSelectOrDefault(['currency'], 'currency', `'ARS'::text`)
      const partsItemsSelect = findColumn(['partsItems'])
        ? `${quoteColumn('partsItems')} AS "partsItems"`
        : `'[]'::jsonb AS "partsItems"`
      const partsTotalSelect = findColumn(['partsTotal']) ? `${quoteColumn('partsTotal')} AS "partsTotal"` : `0 AS "partsTotal"`
      const eligibilitySelect = findColumn(['eligibilityStatus'])
        ? asTextSelect('eligibilityStatus', 'eligibilityStatus')
        : providerFileUrlColumn
          ? `CASE WHEN COALESCE(${quoteColumn(providerFileUrlColumn)}::text, '') <> '' THEN 'READY_FOR_REPAIR' ELSE 'PENDING_ATTACHMENT' END AS "eligibilityStatus"`
          : `'PENDING_ATTACHMENT'::text AS "eligibilityStatus"`
      const linkedRepairSelect = textSelectOrDefault(['linkedRepairId'], 'linkedRepairId', 'NULL::text')
      const providerFileNameSelect = textSelectOrDefault(['providerFileName'], 'providerFileName')
      const providerFileUrlSelect = textSelectOrDefault(['providerFileUrl'], 'providerFileUrl')
      const createdAtSelect = `${quoteColumn(createdAtColumn)} AS "createdAt"`
      const updatedAtSelect = updatedAtColumn
        ? `${quoteColumn(updatedAtColumn)} AS "updatedAt"`
        : `${quoteColumn(createdAtColumn)} AS "updatedAt"`

      const query = `
        SELECT
          ${quoteColumn('id')} AS "id",
          ${quoteColumn('code')} AS "code",
          ${quoteColumn('unitId')} AS "unitId",
          ${companyNameSelect},
          ${descriptionSelect},
          ${tasksSelect},
          ${currencySelect},
          ${partsItemsSelect},
          ${partsTotalSelect},
          ${eligibilitySelect},
          ${linkedRepairSelect},
          ${providerFileNameSelect},
          ${providerFileUrlSelect},
          ${createdAtSelect},
          ${updatedAtSelect}
        FROM "${schema}"."ExternalRequest"
        ORDER BY ${quoteColumn(createdAtColumn)} DESC
      `

      const rows = await prisma.$queryRawUnsafe<RecoveryExternalRequestRow[]>(query)
      allRows.push(...rows)
    } catch (error) {
      console.error(`[ExternalRequest recovery] schema ${schema} ignored due to query mismatch:`, error)
      continue
    }
  }

  return allRows.map(mapRecoveryExternalRequestToPublicShape)
}

const toCreateData = (input: ExternalRequestInput) => {
  const partsItems = normalizePartItems(input.partsItems ?? [])
  const providerFileUrl = (input.providerFileUrl ?? '').trim()

  return {
    id: input.id,
    code: input.code.trim(),
    unitId: input.unitId,
    companyName: input.companyName.trim(),
    description: input.description.trim(),
    tasks: normalizeTasks(input.tasks),
    currency: normalizeCurrency(input.currency),
    partsItems: partsItems as any,
    partsTotal: calculatePartsTotal(partsItems),
    eligibilityStatus: resolveEligibilityStatus(providerFileUrl),
    providerFileName: (input.providerFileName ?? '').trim(),
    providerFileUrl,
    createdAt: input.createdAt ? new Date(input.createdAt) : undefined,
  }
}

const toUpdateData = (input: ExternalRequestUpdateInput, existing: any) => {
  const nextTasks =
    input.tasks !== undefined
      ? normalizeTasks(input.tasks)
      : Array.isArray(existing.tasks)
        ? normalizeTasks(existing.tasks)
        : ['Sin detalle']

  const nextProviderFileUrl =
    input.providerFileUrl !== undefined ? (input.providerFileUrl ?? '').trim() : String(existing.providerFileUrl ?? '')

  const nextPartsItems =
    input.partsItems !== undefined ? normalizePartItems(input.partsItems) : normalizePartItems(existing.partsItems)

  const data: Record<string, unknown> = {
    tasks: nextTasks,
    currency: normalizeCurrency(input.currency ?? existing.currency),
    partsItems: nextPartsItems as any,
    partsTotal: calculatePartsTotal(nextPartsItems),
    eligibilityStatus: resolveEligibilityStatus(nextProviderFileUrl),
    providerFileUrl: nextProviderFileUrl,
  }

  if (input.code !== undefined) {
    data.code = input.code.trim()
  }
  if (input.unitId !== undefined) {
    data.unitId = input.unitId
  }
  if (input.companyName !== undefined) {
    data.companyName = input.companyName.trim()
  }
  if (input.description !== undefined) {
    data.description = input.description.trim()
  }
  if (input.providerFileName !== undefined) {
    data.providerFileName = (input.providerFileName ?? '').trim()
  }
  if (input.createdAt !== undefined && input.createdAt) {
    data.createdAt = new Date(input.createdAt)
  }

  return data
}

const toLegacyCreateData = (input: ExternalRequestInput) => ({
  id: input.id,
  code: input.code.trim(),
  unitId: input.unitId,
  companyName: input.companyName.trim(),
  description: input.description.trim(),
  tasks: normalizeTasks(input.tasks),
  createdAt: input.createdAt && !Number.isNaN(new Date(input.createdAt).getTime()) ? new Date(input.createdAt) : undefined,
})

const scheduleExternalRequestCreatedNotification = (req: AuthenticatedRequest, item: any) => {
  void (async () => {
    try {
      const [actor, unit] = await Promise.all([
        req.userId
          ? runWithSchemaFailover(() =>
              prisma.user.findUnique({ where: { id: req.userId }, select: { fullName: true } }),
            )
          : Promise.resolve(null),
        runWithSchemaFailover(() =>
          prisma.fleetUnit.findUnique({ where: { id: item.unitId }, select: { internalCode: true } }),
        ),
      ])

      const recipients = await resolveOperationalNotificationRecipients(req.userId)
      await pushUserNotifications(recipients, {
        title: 'Nueva nota de pedido',
        description: `${actor?.fullName ?? 'Un usuario'} creo ${item.code}${unit?.internalCode ? ` para ${unit.internalCode}` : ''}.`,
        severity: 'info',
        target: '/work-orders/external-requests',
        actorUserId: req.userId,
        eventType: 'EXTERNAL_REQUEST_CREATED',
      })
    } catch (notificationError) {
      console.error('ExternalRequest notification error:', notificationError)
    }
  })()
}

router.get('/', async (_req, res) => {
  const recoveryPromise = listExternalRequestsFromRecoverySchemas().catch((error) => {
    console.error('ExternalRequest recovery GET error:', error)
    return []
  })

  try {
    // Para lectura mas robusta, priorizamos el recovery SQL multi-schema.
    // Evita que un mismatch del modelo Prisma deje al frontend con cache parcial.
    const recovered = await recoveryPromise
    if (recovered.length > 0) {
      return res.json(recovered)
    }

    const fallbackItems = await runWithSchemaFailover(() =>
      prisma.externalRequest.findMany({ orderBy: { createdAt: 'desc' } }),
    )
    return res.json(fallbackItems)
  } catch (error: any) {
    console.error('ExternalRequest GET error:', error)
    const recovered = await recoveryPromise
    if (recovered.length > 0) {
      return res.json(recovered)
    }
    return res.status(500).json({ message: 'No se pudieron cargar las notas de pedido.' })
  }
})

router.post('/', async (req: AuthenticatedRequest, res) => {
  const parsed = externalRequestSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
  }

  try {
    const data = toCreateData(parsed.data)
    const item = await runWithSchemaFailover(() => prisma.externalRequest.create({ data }))
    res.status(201).json(item)
    scheduleExternalRequestCreatedNotification(req, item)
    return
  } catch (error: any) {
    console.error('ExternalRequest CREATE error:', error)

    const isExternalRequestColumnMismatch = error?.code === 'P2022'
    if (isExternalRequestColumnMismatch) {
      try {
        const legacyData = toLegacyCreateData(parsed.data)
        const legacyItem = await runWithSchemaFailover(() =>
          prisma.externalRequest.create({ data: legacyData as any }),
        )
        res.status(201).json(legacyItem)
        scheduleExternalRequestCreatedNotification(req, legacyItem)
        return
      } catch (legacyError: any) {
        console.error('ExternalRequest CREATE legacy fallback error:', legacyError)
      }
    }

    // Ultima red de seguridad: si ya existe por id o code, devolverla y liberar cola.
    const normalizedCode = parsed.data.code.trim()
    const normalizedId = parsed.data.id?.trim() ?? ''
    try {
      const orConditions: Array<Record<string, string>> = []
      if (normalizedId) {
        orConditions.push({ id: normalizedId })
      }
      if (normalizedCode) {
        orConditions.push({ code: normalizedCode })
      }
      if (orConditions.length > 0) {
        const existing = await runWithSchemaFailover(() =>
          prisma.externalRequest.findFirst({
            where: { OR: orConditions as any },
          }),
        )
        if (existing) {
          return res.status(200).json(existing)
        }
      }
    } catch (lookupError) {
      console.error('ExternalRequest CREATE existing lookup error:', lookupError)
    }

    if (error?.code === 'P2002') {
      return res.status(409).json({ message: 'Registro duplicado.' })
    }
    if (error?.code === 'P2003') {
      return res.status(409).json({ message: 'Unidad no valida.' })
    }
    return res.status(500).json({ message: 'No se pudo crear la nota de pedido.' })
  }
})

router.patch('/:id', async (req, res) => {
  const parsed = externalRequestUpdateSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
  }

  try {
    const item = await runWithSchemaFailover(async () => {
      const existing = await prisma.externalRequest.findUnique({ where: { id: req.params.id } })
      if (!existing) {
        const notFoundError = new Error('ExternalRequest not found')
        ;(notFoundError as any).code = 'NOT_FOUND'
        throw notFoundError
      }
      const data = toUpdateData(parsed.data, existing)
      return prisma.externalRequest.update({ where: { id: req.params.id }, data })
    })
    return res.json(item)
  } catch (error: any) {
    if (error?.code === 'NOT_FOUND' || error?.code === 'P2025') {
      return res.status(404).json({ message: 'La nota de pedido no existe.' })
    }
    console.error('ExternalRequest PATCH error:', error)
    return res.status(500).json({ message: 'No se pudo actualizar la nota de pedido.' })
  }
})

router.delete('/:id', async (req, res) => {
  try {
    await runWithSchemaFailover(async () => {
      const existing = await prisma.externalRequest.findUnique({
        where: { id: req.params.id },
        select: { id: true, linkedRepairId: true },
      })
      if (!existing) {
        const notFoundError = new Error('ExternalRequest not found')
        ;(notFoundError as any).code = 'NOT_FOUND'
        throw notFoundError
      }
      if (existing.linkedRepairId) {
        const linkedError = new Error('ExternalRequest linked to repair')
        ;(linkedError as any).code = 'REQUEST_LINKED'
        throw linkedError
      }
      await prisma.externalRequest.delete({ where: { id: req.params.id } })
    })
    return res.status(204).send()
  } catch (error: any) {
    if (error?.code === 'NOT_FOUND' || error?.code === 'P2025') {
      return res.status(404).json({ message: 'La nota de pedido no existe.' })
    }
    if (error?.code === 'REQUEST_LINKED') {
      return res.status(409).json({ message: 'No se puede eliminar una NDP ya vinculada a una reparacion.' })
    }
    console.error('ExternalRequest DELETE error:', error)
    return res.status(500).json({ message: 'No se pudo eliminar la nota de pedido.' })
  }
})

export default router
