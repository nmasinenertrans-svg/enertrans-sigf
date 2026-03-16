import { PrismaClient } from '@prisma/client'

type ProbeResult = {
  schema: string
  score: number
  hasFleetUnitTable: boolean
  hasSupplierTable: boolean
  hasClientAccountTable: boolean
  hasDeliveryOperationTable: boolean
  hasFleetClientIdColumn: boolean
}

const DEFAULT_SCHEMA_CANDIDATES = ['enertrans_prod', 'public']

const normalizeSchema = (value: string): string => value.trim().toLowerCase()

const parseSchemaFromUrl = (url: string): string | null => {
  const match = url.match(/[?&]schema=([^&]+)/i)
  if (!match?.[1]) {
    return null
  }
  try {
    return decodeURIComponent(match[1]).trim() || null
  } catch {
    return match[1].trim() || null
  }
}

const withSchemaInUrl = (url: string, schema: string): string => {
  const encodedSchema = encodeURIComponent(schema)
  if (/([?&])schema=[^&]*/i.test(url)) {
    return url.replace(/([?&])schema=[^&]*/i, `$1schema=${encodedSchema}`)
  }
  return `${url}${url.includes('?') ? '&' : '?'}schema=${encodedSchema}`
}

const gatherSchemaCandidates = (databaseUrl: string): string[] => {
  const fromUrl = parseSchemaFromUrl(databaseUrl)
  const fromEnv = (process.env.DATABASE_SCHEMA_FALLBACKS ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

  const combined = [...(fromUrl ? [fromUrl] : []), ...fromEnv, ...DEFAULT_SCHEMA_CANDIDATES]

  const unique: string[] = []
  const seen = new Set<string>()
  combined.forEach((item) => {
    const normalized = normalizeSchema(item)
    if (!normalized || seen.has(normalized)) {
      return
    }
    seen.add(normalized)
    unique.push(item)
  })

  return unique
}

const probeSchema = async (databaseUrl: string, schema: string): Promise<ProbeResult | null> => {
  const probeClient = new PrismaClient({ datasourceUrl: databaseUrl })
  try {
    const tableRows = await probeClient.$queryRaw<{ table_name: string }[]>`
      SELECT table_name
      FROM information_schema.tables
      WHERE lower(table_schema) = lower(${schema})
        AND lower(table_name) IN ('fleetunit', 'supplier', 'clientaccount', 'deliveryoperation')
    `

    const columnRows = await probeClient.$queryRaw<{ column_name: string }[]>`
      SELECT column_name
      FROM information_schema.columns
      WHERE lower(table_schema) = lower(${schema})
        AND lower(table_name) = 'fleetunit'
        AND lower(column_name) = 'clientid'
    `

    const tableSet = new Set(tableRows.map((row) => normalizeSchema(row.table_name)))
    const hasFleetUnitTable = tableSet.has('fleetunit')
    const hasSupplierTable = tableSet.has('supplier')
    const hasClientAccountTable = tableSet.has('clientaccount')
    const hasDeliveryOperationTable = tableSet.has('deliveryoperation')
    const hasFleetClientIdColumn = columnRows.length > 0

    const score =
      (hasFleetUnitTable ? 30 : 0) +
      (hasFleetClientIdColumn ? 30 : 0) +
      (hasSupplierTable ? 20 : 0) +
      (hasClientAccountTable ? 10 : 0) +
      (hasDeliveryOperationTable ? 10 : 0)

    return {
      schema,
      score,
      hasFleetUnitTable,
      hasSupplierTable,
      hasClientAccountTable,
      hasDeliveryOperationTable,
      hasFleetClientIdColumn,
    }
  } catch {
    return null
  } finally {
    await probeClient.$disconnect().catch(() => undefined)
  }
}

const baseDatasourceUrl = process.env.DATABASE_URL
if (!baseDatasourceUrl) {
  throw new Error('DATABASE_URL no configurada.')
}

let activeDatasourceUrl = baseDatasourceUrl
let activeSchema = parseSchemaFromUrl(baseDatasourceUrl) ?? 'default'

export let prisma = new PrismaClient({
  datasourceUrl: activeDatasourceUrl,
})

const activateSchema = async (schema: string): Promise<boolean> => {
  const nextUrl = withSchemaInUrl(baseDatasourceUrl, schema)
  if (nextUrl === activeDatasourceUrl) {
    activeSchema = schema
    return true
  }

  const nextClient = new PrismaClient({ datasourceUrl: nextUrl })

  try {
    await nextClient.$queryRawUnsafe('SELECT 1')

    const previous = prisma
    prisma = nextClient
    activeDatasourceUrl = nextUrl
    activeSchema = schema

    await previous.$disconnect().catch(() => undefined)
    return true
  } catch {
    await nextClient.$disconnect().catch(() => undefined)
    return false
  }
}

const probeCandidates = async (): Promise<ProbeResult[]> => {
  const candidates = gatherSchemaCandidates(baseDatasourceUrl)
  if (candidates.length === 0) {
    return []
  }

  const probeResults: ProbeResult[] = []
  for (const schema of candidates) {
    const result = await probeSchema(baseDatasourceUrl, schema)
    if (result) {
      probeResults.push(result)
    }
  }

  if (probeResults.length > 0) {
    console.log(
      `[DB] probe schemas: ${probeResults
        .map(
          (result) =>
            `${result.schema}(score=${result.score},fleet=${result.hasFleetUnitTable},clientId=${result.hasFleetClientIdColumn},supplier=${result.hasSupplierTable},client=${result.hasClientAccountTable},delivery=${result.hasDeliveryOperationTable})`,
        )
        .join(' | ')}`,
    )
  }

  return probeResults
}

const pickBestSchema = (results: ProbeResult[], excludeCurrent: boolean): ProbeResult | null => {
  const filtered = excludeCurrent
    ? results.filter((result) => normalizeSchema(result.schema) !== normalizeSchema(activeSchema))
    : results

  if (filtered.length === 0) {
    return null
  }

  return filtered.sort((a, b) => b.score - a.score)[0] ?? null
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
  return message.includes('does not exist in the current database') || message.includes('table') && message.includes('does not exist')
}

let schemaRecoveryPromise: Promise<boolean> | null = null

const recoverSchemaFromRuntimeError = async (): Promise<boolean> => {
  const results = await probeCandidates()
  if (results.length === 0) {
    return false
  }

  const bestAlternative = pickBestSchema(results, true)
  if (!bestAlternative || bestAlternative.score <= 0) {
    return false
  }

  const switched = await activateSchema(bestAlternative.schema)
  if (switched) {
    console.log(`[DB] schema failover aplicado a: ${bestAlternative.schema}`)
  }
  return switched
}

export const runWithSchemaFailover = async <T>(operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation()
  } catch (error) {
    if (!isSchemaMismatchError(error)) {
      throw error
    }

    if (!schemaRecoveryPromise) {
      schemaRecoveryPromise = recoverSchemaFromRuntimeError().finally(() => {
        schemaRecoveryPromise = null
      })
    }

    const switched = await schemaRecoveryPromise
    if (!switched) {
      throw error
    }

    return operation()
  }
}

export const ensureBestPrismaSchema = async (): Promise<void> => {
  const forcedSchema = process.env.DATABASE_SCHEMA_FORCE?.trim()
  if (forcedSchema) {
    await activateSchema(forcedSchema)
    console.log(`[DB] esquema forzado por env: ${activeSchema}`)
    return
  }

  const probeResults = await probeCandidates()
  if (probeResults.length === 0) {
    return
  }

  const best = pickBestSchema(probeResults, false)
  if (!best || best.score <= 0) {
    return
  }

  await activateSchema(best.schema)

  console.log(
    `[DB] esquema activo: ${activeSchema} (score ${best.score}, supplier=${best.hasSupplierTable}, client=${best.hasClientAccountTable}, delivery=${best.hasDeliveryOperationTable}, fleet.clientId=${best.hasFleetClientIdColumn})`,
  )
}

export const getActiveDbSchema = (): string => activeSchema
