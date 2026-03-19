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
  companyName: string
  description: string
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

const mapRecoveryExternalRequestToPublicShape = (row: RecoveryExternalRequestRow) => ({
  id: row.id,
  code: row.code,
  unitId: row.unitId,
  companyName: row.companyName,
  description: row.description,
  tasks: Array.isArray(row.tasks) ? row.tasks.map((task) => String(task ?? '').trim()).filter(Boolean) : [],
  currency: normalizeCurrency(row.currency),
  partsItems: normalizePartItems(row.partsItems),
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

    const columnRows = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = ${schema}
        AND table_name = 'ExternalRequest'
    `
    const columns = new Set(columnRows.map((row) => row.column_name))
    const currencySelect = columns.has('currency') ? `"currency"::text` : `'ARS'::text AS "currency"`
    const partsItemsSelect = columns.has('partsItems') ? `"partsItems"` : `'[]'::jsonb AS "partsItems"`
    const partsTotalSelect = columns.has('partsTotal') ? `"partsTotal"` : `0 AS "partsTotal"`
    const eligibilitySelect = columns.has('eligibilityStatus')
      ? `"eligibilityStatus"`
      : `CASE WHEN COALESCE("providerFileUrl", '') <> '' THEN 'READY_FOR_REPAIR' ELSE 'PENDING_ATTACHMENT' END AS "eligibilityStatus"`
    const linkedRepairSelect = columns.has('linkedRepairId') ? `"linkedRepairId"` : `NULL::text AS "linkedRepairId"`
    const providerFileNameSelect = columns.has('providerFileName')
      ? `"providerFileName"`
      : `''::text AS "providerFileName"`
    const providerFileUrlSelect = columns.has('providerFileUrl') ? `"providerFileUrl"` : `''::text AS "providerFileUrl"`
    const updatedAtSelect = columns.has('updatedAt') ? `"updatedAt"` : `"createdAt" AS "updatedAt"`

    const query = `
      SELECT
        "id",
        "code",
        "unitId",
        "companyName",
        "description",
        "tasks",
        ${currencySelect},
        ${partsItemsSelect},
        ${partsTotalSelect},
        ${eligibilitySelect},
        ${linkedRepairSelect},
        ${providerFileNameSelect},
        ${providerFileUrlSelect},
        "createdAt",
        ${updatedAtSelect}
      FROM "${schema}"."ExternalRequest"
      ORDER BY "createdAt" DESC
    `

    const rows = await prisma.$queryRawUnsafe<RecoveryExternalRequestRow[]>(query)
    allRows.push(...rows)
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

router.get('/', async (_req, res) => {
  const recoveryPromise = listExternalRequestsFromRecoverySchemas().catch((error) => {
    console.error('ExternalRequest recovery GET error:', error)
    return []
  })

  try {
    const items = await runWithSchemaFailover(() => prisma.externalRequest.findMany({ orderBy: { createdAt: 'desc' } }))
    const recovered = await recoveryPromise
    return res.json(mergeExternalRequests(items, recovered))
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
    const [actor, unit] = await Promise.all([
      req.userId ? prisma.user.findUnique({ where: { id: req.userId }, select: { fullName: true } }) : Promise.resolve(null),
      prisma.fleetUnit.findUnique({ where: { id: item.unitId }, select: { internalCode: true } }),
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

    return res.status(201).json(item)
  } catch (error: any) {
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
