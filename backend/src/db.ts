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

  const combined = [
    ...(fromUrl ? [fromUrl] : []),
    ...fromEnv,
    ...DEFAULT_SCHEMA_CANDIDATES,
  ]

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

export const ensureBestPrismaSchema = async (): Promise<void> => {
  const forcedSchema = process.env.DATABASE_SCHEMA_FORCE?.trim()
  if (forcedSchema) {
    const forcedUrl = withSchemaInUrl(baseDatasourceUrl, forcedSchema)
    if (forcedUrl !== activeDatasourceUrl) {
      const forcedClient = new PrismaClient({ datasourceUrl: forcedUrl })
      try {
        await forcedClient.$queryRawUnsafe('SELECT 1')
        const previous = prisma
        prisma = forcedClient
        activeDatasourceUrl = forcedUrl
        activeSchema = forcedSchema
        await previous.$disconnect().catch(() => undefined)
      } catch {
        await forcedClient.$disconnect().catch(() => undefined)
      }
    } else {
      activeSchema = forcedSchema
    }
    console.log(`[DB] esquema forzado por env: ${activeSchema}`)
    return
  }

  const candidates = gatherSchemaCandidates(baseDatasourceUrl)
  if (candidates.length === 0) {
    return
  }

  const probeResults: ProbeResult[] = []
  for (const schema of candidates) {
    const result = await probeSchema(baseDatasourceUrl, schema)
    if (result) {
      probeResults.push(result)
    }
  }

  if (probeResults.length === 0) {
    return
  }

  console.log(
    `[DB] probe schemas: ${probeResults
      .map(
        (result) =>
          `${result.schema}(score=${result.score},fleet=${result.hasFleetUnitTable},clientId=${result.hasFleetClientIdColumn},supplier=${result.hasSupplierTable},client=${result.hasClientAccountTable},delivery=${result.hasDeliveryOperationTable})`,
      )
      .join(' | ')}`,
  )

  const best = probeResults.sort((a, b) => b.score - a.score)[0]
  if (!best || best.score <= 0) {
    return
  }

  const nextUrl = withSchemaInUrl(baseDatasourceUrl, best.schema)
  if (nextUrl === activeDatasourceUrl) {
    activeSchema = best.schema
    console.log(`[DB] esquema activo: ${activeSchema} (score ${best.score})`)
    return
  }

  const nextClient = new PrismaClient({ datasourceUrl: nextUrl })

  try {
    await nextClient.$queryRawUnsafe('SELECT 1')

    const previous = prisma
    prisma = nextClient
    activeDatasourceUrl = nextUrl
    activeSchema = best.schema

    await previous.$disconnect().catch(() => undefined)

    console.log(
      `[DB] esquema activo: ${activeSchema} (score ${best.score}, supplier=${best.hasSupplierTable}, client=${best.hasClientAccountTable}, delivery=${best.hasDeliveryOperationTable}, fleet.clientId=${best.hasFleetClientIdColumn})`,
    )
  } catch {
    await nextClient.$disconnect().catch(() => undefined)
  }
}

export const getActiveDbSchema = (): string => activeSchema
