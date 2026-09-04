import { PrismaClient } from '@prisma/client'

type ProbeResult = {
  schema: string
  score: number
  isCoreReady: boolean
  hasUserTable: boolean
  hasRepairRecordTable: boolean
  hasFleetUnitTable: boolean
  hasSupplierTable: boolean
  hasClientAccountTable: boolean
  hasDeliveryOperationTable: boolean
  hasFleetClientIdColumn: boolean
  fleetUnitRowCount: number
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
        AND table_name IN ('User', 'FleetUnit', 'RepairRecord', 'Supplier', 'ClientAccount', 'DeliveryOperation')
    `

    const columnRows = await probeClient.$queryRaw<{ column_name: string }[]>`
      SELECT column_name
      FROM information_schema.columns
      WHERE lower(table_schema) = lower(${schema})
        AND table_name = 'FleetUnit'
        AND column_name = 'clientId'
    `

    const tableSet = new Set(tableRows.map((row) => row.table_name))
    const hasUserTable = tableSet.has('User')
    const hasRepairRecordTable = tableSet.has('RepairRecord')
    const hasFleetUnitTable = tableSet.has('FleetUnit')
    const hasSupplierTable = tableSet.has('Supplier')
    const hasClientAccountTable = tableSet.has('ClientAccount')
    const hasDeliveryOperationTable = tableSet.has('DeliveryOperation')
    const hasFleetClientIdColumn = columnRows.length > 0

    // Dos schemas pueden tener exactamente la misma estructura (tablas/columnas)
    // sin tener los mismos DATOS — uno puede estar vacio y el otro con toda la
    // operacion real. El puntaje estructural de arriba por si solo puede empatar
    // en ese caso, y en un empate gana el primero de la lista (el schema del
    // DATABASE_URL), que puede ser el vacio. Por eso la cantidad real de filas en
    // FleetUnit pesa muchisimo mas que cualquier combinacion de banderas
    // estructurales: un schema con datos reales SIEMPRE gana sobre uno vacio,
    // sin importar que tan "completo" luzca su estructura.
    let fleetUnitRowCount = 0
    if (hasFleetUnitTable) {
      try {
        const countRows = await probeClient.$queryRawUnsafe<{ count: bigint }[]>(
          `SELECT COUNT(*)::bigint AS count FROM ${quoteIdentifier(schema)}."FleetUnit"`,
        )
        fleetUnitRowCount = Number(countRows[0]?.count ?? 0)
      } catch {
        fleetUnitRowCount = 0
      }
    }

    const isCoreReady = hasUserTable && hasFleetUnitTable && hasRepairRecordTable

    const structuralScore =
      (hasUserTable ? 40 : 0) +
      (hasFleetUnitTable ? 40 : 0) +
      (hasRepairRecordTable ? 20 : 0) +
      (hasFleetClientIdColumn ? 20 : 0) +
      (hasSupplierTable ? 20 : 0) +
      (hasClientAccountTable ? 10 : 0) +
      (hasDeliveryOperationTable ? 10 : 0)

    const score = structuralScore + (fleetUnitRowCount > 0 ? 100000 : 0) + Math.min(fleetUnitRowCount, 5000)

    return {
      schema,
      score,
      isCoreReady,
      hasUserTable,
      hasRepairRecordTable,
      hasFleetUnitTable,
      hasSupplierTable,
      hasClientAccountTable,
      hasDeliveryOperationTable,
      hasFleetClientIdColumn,
      fleetUnitRowCount,
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

const COMPAT_TABLE_NAMES = [
  'User',
  'FleetUnit',
  'WorkOrder',
  'AuditRecord',
  'RepairRecord',
  'Supplier',
  'ClientAccount',
  'DeliveryOperation',
  'CrmDeal',
  'CrmActivity',
  'CrmDealUnit',
  'ExternalRequest',
  'FleetProject',
  'FleetProjectItem',
  'PostventaEvent',
  'ServiceOrder',
  'PushSubscription',
  'Invoice',
  'TelemetryDevice',
  'TelemetryPosition',
  'RentalContract',
  'HandoverChecklist',
  'Tire',
  'Trip',
  'TripLeg',
] as const

const getNormalizedActiveSchema = (): string => {
  const trimmed = activeSchema.trim()
  return trimmed.length > 0 ? trimmed : 'public'
}

const quoteIdentifier = (value: string): string => `"${value.replace(/"/g, '""')}"`

const qualifyCompatSql = (sql: string): string => {
  const schema = quoteIdentifier(getNormalizedActiveSchema())
  let next = sql
  for (const tableName of COMPAT_TABLE_NAMES) {
    const tableIdentifier = quoteIdentifier(tableName)
    const qualifiedTable = `${schema}.${tableIdentifier}`
    next = next.replace(new RegExp(tableIdentifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), qualifiedTable)
  }
  return next
}

const safeExecuteCompatSql = async (sql: string): Promise<void> => {
  const qualified = qualifyCompatSql(sql)
  try {
    await prisma.$executeRawUnsafe(qualified)
  } catch (error) {
    console.warn('[DB] error en SQL de compatibilidad:', error, '| sql:', qualified.trim().slice(0, 300))
  }
}

// Agrega un valor nuevo a un enum ya existente (ej. sumar 'COMMENT' a TaskEventType)
// sin depender de que `prisma db push` haya corrido contra el schema activo.
const safeAddEnumValue = async (typeName: string, value: string): Promise<void> => {
  const schema = getNormalizedActiveSchema()
  const quotedSchema = quoteIdentifier(schema)
  const quotedType = quoteIdentifier(typeName)
  try {
    await prisma.$executeRawUnsafe(
      `ALTER TYPE ${quotedSchema}.${quotedType} ADD VALUE IF NOT EXISTS '${value.replace(/'/g, "''")}';`,
    )
  } catch (error) {
    console.warn(`[DB] error agregando valor ${value} a enum ${schema}.${typeName}:`, error)
  }
}

// Crea un tipo enum en el esquema activo de forma explícita (sin depender de current_schema() en SQL).
// Usa el nombre del esquema activo desde TypeScript para evitar ambigüedad de search_path.
const safeCreateEnumType = async (typeName: string, values: string[]): Promise<void> => {
  const schema = getNormalizedActiveSchema()
  const quotedSchema = quoteIdentifier(schema)
  const quotedType = quoteIdentifier(typeName)
  const enumValues = values.map(v => `'${v.replace(/'/g, "''")}'`).join(', ')
  const sql = `
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = '${typeName}' AND n.nspname = '${schema}'
      ) THEN
        CREATE TYPE ${quotedSchema}.${quotedType} AS ENUM (${enumValues});
      END IF;
    END
    $$;
  `
  try {
    await prisma.$executeRawUnsafe(sql)
  } catch (error) {
    console.warn(`[DB] error creando tipo ${schema}.${typeName}:`, error)
  }
}

// Si una columna enum apunta al tipo de otro schema (ej: public."CrmDealStage"),
// la migra al tipo del schema activo con DROP DEFAULT → ALTER TYPE → SET DEFAULT.
// El DEFAULT hay que dropearlo antes porque PostgreSQL no puede castear automáticamente
// un valor default del tipo viejo al tipo nuevo.
const safeFixEnumColumn = async (
  tableName: string,
  columnName: string,
  typeName: string,
  defaultValue?: string,
): Promise<void> => {
  const schema = getNormalizedActiveSchema()
  const quotedSchema = quoteIdentifier(schema)
  const quotedTable = quoteIdentifier(tableName)
  const quotedColumn = quoteIdentifier(columnName)
  const quotedType = quoteIdentifier(typeName)
  const restoreDefault = defaultValue
    ? `ALTER TABLE ${quotedSchema}.${quotedTable} ALTER COLUMN ${quotedColumn} SET DEFAULT '${defaultValue.replace(/'/g, "''")}'::"${schema}"."${typeName}";`
    : ''
  const sql = `
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM pg_attribute a
        JOIN pg_class r ON r.oid = a.attrelid AND r.relname = '${tableName}'
        JOIN pg_namespace rn ON rn.oid = r.relnamespace AND rn.nspname = '${schema}'
        JOIN pg_type t ON t.oid = a.atttypid AND t.typname = '${typeName}'
        JOIN pg_namespace tn ON tn.oid = t.typnamespace AND tn.nspname != '${schema}'
        WHERE a.attname = '${columnName}' AND a.attnum > 0
      ) THEN
        ALTER TABLE ${quotedSchema}.${quotedTable} ALTER COLUMN ${quotedColumn} DROP DEFAULT;
        ALTER TABLE ${quotedSchema}.${quotedTable}
          ALTER COLUMN ${quotedColumn} TYPE ${quotedSchema}.${quotedType}
          USING ${quotedColumn}::text::${quotedSchema}.${quotedType};
        ${restoreDefault}
      END IF;
    END
    $$;
  `
  try {
    await prisma.$executeRawUnsafe(sql)
    console.log(`[DB] columna ${schema}.${tableName}.${columnName} migrada a tipo ${schema}.${typeName}`)
  } catch (error) {
    console.warn(`[DB] error migrando columna ${tableName}.${columnName}:`, error)
  }
}

const tableExistsInActiveSchema = async (tableName: string): Promise<boolean> => {
  const schema = getNormalizedActiveSchema()
  try {
    const rows = await prisma.$queryRaw<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE lower(table_schema) = lower(${schema})
          AND table_name = ${tableName}
      ) AS exists
    `
    return Boolean(rows[0]?.exists)
  } catch {
    return false
  }
}

const columnExistsInActiveSchema = async (tableName: string, columnName: string): Promise<boolean> => {
  const schema = getNormalizedActiveSchema()
  try {
    const rows = await prisma.$queryRaw<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE lower(table_schema) = lower(${schema})
          AND table_name = ${tableName}
          AND column_name = ${columnName}
      ) AS exists
    `
    return Boolean(rows[0]?.exists)
  } catch {
    return false
  }
}

export const ensureRuntimeSchemaCompatibility = async (): Promise<void> => {
  // Fleet: agrega columnas operativas nuevas si la tabla existe en schema activo.
  const hasFleetUnitTable = await tableExistsInActiveSchema('FleetUnit')
  if (hasFleetUnitTable) {
    await safeExecuteCompatSql(`ALTER TABLE "FleetUnit" ADD COLUMN IF NOT EXISTS "clientId" TEXT;`)
    await safeExecuteCompatSql(`ALTER TABLE "FleetUnit" ADD COLUMN IF NOT EXISTS "clientName" TEXT NOT NULL DEFAULT '';`)
    await safeExecuteCompatSql(
      `ALTER TABLE "FleetUnit" ADD COLUMN IF NOT EXISTS "logisticsStatus" TEXT NOT NULL DEFAULT 'AVAILABLE';`,
    )
    await safeExecuteCompatSql(
      `ALTER TABLE "FleetUnit" ADD COLUMN IF NOT EXISTS "logisticsStatusNote" TEXT NOT NULL DEFAULT '';`,
    )
    await safeExecuteCompatSql(`ALTER TABLE "FleetUnit" ADD COLUMN IF NOT EXISTS "logisticsUpdatedAt" TIMESTAMP(3);`)
    await safeExecuteCompatSql(`ALTER TABLE "FleetUnit" ADD COLUMN IF NOT EXISTS "engineCylinders" INTEGER;`)
    await safeExecuteCompatSql(`ALTER TABLE "FleetUnit" ADD COLUMN IF NOT EXISTS "profilePhotoUrl" TEXT;`)
    await safeExecuteCompatSql(`CREATE INDEX IF NOT EXISTS "FleetUnit_clientId_idx" ON "FleetUnit"("clientId");`)
    await safeExecuteCompatSql(
      `CREATE INDEX IF NOT EXISTS "FleetUnit_logisticsStatus_idx" ON "FleetUnit"("logisticsStatus");`,
    )

    // ServiceOrder: crea enum types y tabla
    await safeCreateEnumType('ServiceOrderStatus', ['OPEN', 'IN_PROGRESS', 'WAITING_PARTS', 'CLOSED'])
    await safeCreateEnumType('ServiceOrderOrigin', ['EMAIL', 'PHONE_CALL', 'WHATSAPP', 'INTERNAL_INSPECTION'])
    await safeExecuteCompatSql(`
      CREATE TABLE IF NOT EXISTS "ServiceOrder" (
        "id"                    TEXT NOT NULL DEFAULT md5(random()::text || clock_timestamp()::text),
        "code"                  TEXT NOT NULL,
        "unitId"                TEXT,
        "externalVehicle"       TEXT,
        "clientId"              TEXT,
        "clientName"            TEXT NOT NULL DEFAULT '',
        "reportedFault"         TEXT NOT NULL DEFAULT '',
        "claimOrigin"           TEXT NOT NULL DEFAULT 'EMAIL',
        "status"                TEXT NOT NULL DEFAULT 'OPEN',
        "estimatedResolutionAt" TIMESTAMP(3),
        "closedAt"              TIMESTAMP(3),
        "resolutionDetail"      TEXT NOT NULL DEFAULT '',
        "assignedToUserId"      TEXT,
        "assignedToName"        TEXT NOT NULL DEFAULT '',
        "sparePartsUsed"        TEXT NOT NULL DEFAULT '',
        "photoUrls"             JSONB NOT NULL DEFAULT '[]'::jsonb,
        "createdByUserId"       TEXT NOT NULL DEFAULT '',
        "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "ServiceOrder_pkey" PRIMARY KEY ("id")
      );
    `)
    await safeExecuteCompatSql(`CREATE UNIQUE INDEX IF NOT EXISTS "ServiceOrder_code_key" ON "ServiceOrder"("code");`)
    await safeExecuteCompatSql(`CREATE INDEX IF NOT EXISTS "ServiceOrder_unitId_createdAt_idx" ON "ServiceOrder"("unitId","createdAt");`)
    await safeExecuteCompatSql(`CREATE INDEX IF NOT EXISTS "ServiceOrder_status_createdAt_idx" ON "ServiceOrder"("status","createdAt");`)
    await safeExecuteCompatSql(`CREATE INDEX IF NOT EXISTS "ServiceOrder_clientId_idx" ON "ServiceOrder"("clientId");`)
    await safeExecuteCompatSql(`CREATE INDEX IF NOT EXISTS "ServiceOrder_assignedToUserId_idx" ON "ServiceOrder"("assignedToUserId");`)

    // WorkOrder y AuditRecord: schema-qualified directo para evitar problemas de qualifyCompatSql
    const sq = quoteIdentifier(getNormalizedActiveSchema())
    for (const [tbl, col, type] of [
      ['WorkOrder', 'externalVehicle', 'TEXT'] as const,
      ['AuditRecord', 'externalVehicle', 'TEXT'] as const,
    ]) {
      try {
        await prisma.$executeRawUnsafe(`ALTER TABLE ${sq}."${tbl}" ADD COLUMN IF NOT EXISTS "${col}" ${type}`)
      } catch (err) {
        console.warn(`[DB] ADD COLUMN ${tbl}.${col}:`, err)
      }
    }
    for (const tbl of ['WorkOrder', 'AuditRecord'] as const) {
      try {
        await prisma.$executeRawUnsafe(`ALTER TABLE ${sq}."${tbl}" ALTER COLUMN "unitId" DROP NOT NULL`)
      } catch (err) {
        console.warn(`[DB] DROP NOT NULL ${tbl}.unitId:`, err)
      }
    }

    // Proyectos de modificación de flota
    await safeExecuteCompatSql(`
      CREATE TABLE IF NOT EXISTS "FleetProject" (
        "id" TEXT NOT NULL DEFAULT md5(random()::text || clock_timestamp()::text),
        "title" TEXT NOT NULL,
        "projectType" TEXT NOT NULL DEFAULT 'OTHER',
        "status" TEXT NOT NULL DEFAULT 'PENDING',
        "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
        "unitId" TEXT NOT NULL,
        "description" TEXT NOT NULL DEFAULT '',
        "estimatedCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "actualCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "currency" TEXT NOT NULL DEFAULT 'ARS',
        "assignedToUserId" TEXT,
        "createdByUserId" TEXT NOT NULL,
        "targetDate" TIMESTAMP(3),
        "startedAt" TIMESTAMP(3),
        "completedAt" TIMESTAMP(3),
        "modificationNotes" TEXT NOT NULL DEFAULT '',
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "FleetProject_pkey" PRIMARY KEY ("id")
      );
    `)
    await safeExecuteCompatSql(`
      CREATE TABLE IF NOT EXISTS "FleetProjectItem" (
        "id" TEXT NOT NULL DEFAULT md5(random()::text || clock_timestamp()::text),
        "projectId" TEXT NOT NULL,
        "title" TEXT NOT NULL,
        "description" TEXT NOT NULL DEFAULT '',
        "status" TEXT NOT NULL DEFAULT 'PENDING',
        "assignedToUserId" TEXT,
        "completedAt" TIMESTAMP(3),
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "FleetProjectItem_pkey" PRIMARY KEY ("id")
      );
    `)
    await safeExecuteCompatSql(`ALTER TABLE "FleetProject" ADD COLUMN IF NOT EXISTS "externalRequestId" TEXT;`)
    await safeExecuteCompatSql(`ALTER TABLE "FleetProject" ADD COLUMN IF NOT EXISTS "linkedWorkOrderIds" JSONB NOT NULL DEFAULT '[]'::jsonb;`)
    await safeExecuteCompatSql(`ALTER TABLE "FleetProject" ADD COLUMN IF NOT EXISTS "linkedExternalRequestIds" JSONB NOT NULL DEFAULT '[]'::jsonb;`)
    await safeExecuteCompatSql(`ALTER TABLE "FleetProject" ADD COLUMN IF NOT EXISTS "projectTypes" JSONB NOT NULL DEFAULT '[]'::jsonb;`)
    await safeExecuteCompatSql(`ALTER TABLE "FleetProject" ALTER COLUMN "projectType" SET DEFAULT 'OTHER';`)
    await safeExecuteCompatSql(`ALTER TABLE "FleetProject" ALTER COLUMN "projectType" DROP NOT NULL;`)
    await safeExecuteCompatSql(`CREATE INDEX IF NOT EXISTS "FleetProject_unitId_idx" ON "FleetProject"("unitId");`)
    await safeExecuteCompatSql(`CREATE INDEX IF NOT EXISTS "FleetProject_status_idx" ON "FleetProject"("status");`)
    await safeExecuteCompatSql(`CREATE INDEX IF NOT EXISTS "FleetProjectItem_projectId_idx" ON "FleetProjectItem"("projectId");`)

    // Postventa calendar events
    await safeExecuteCompatSql(`
      CREATE TABLE IF NOT EXISTS "PostventaEvent" (
        "id" TEXT NOT NULL DEFAULT md5(random()::text || clock_timestamp()::text),
        "title" TEXT NOT NULL,
        "startDate" TIMESTAMP(3) NOT NULL,
        "endDate" TIMESTAMP(3),
        "notes" TEXT NOT NULL DEFAULT '',
        "unitId" TEXT,
        "externalVehicle" TEXT,
        "workOrderId" TEXT,
        "color" TEXT NOT NULL DEFAULT 'amber',
        "createdByUserId" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "PostventaEvent_pkey" PRIMARY KEY ("id")
      );
    `)
    await safeExecuteCompatSql(`CREATE INDEX IF NOT EXISTS "PostventaEvent_startDate_idx" ON "PostventaEvent"("startDate");`)
    await safeExecuteCompatSql(`CREATE INDEX IF NOT EXISTS "PostventaEvent_unitId_idx" ON "PostventaEvent"("unitId");`)
  }

  // Clientes: crea tabla si falta.
  await safeExecuteCompatSql(`
    CREATE TABLE IF NOT EXISTS "ClientAccount" (
      "id" TEXT NOT NULL DEFAULT md5(random()::text || clock_timestamp()::text),
      "name" TEXT NOT NULL,
      "legalName" TEXT NOT NULL DEFAULT '',
      "taxId" TEXT NOT NULL DEFAULT '',
      "contactName" TEXT NOT NULL DEFAULT '',
      "contactPhone" TEXT NOT NULL DEFAULT '',
      "contactEmail" TEXT NOT NULL DEFAULT '',
      "notes" TEXT NOT NULL DEFAULT '',
      "isActive" BOOLEAN NOT NULL DEFAULT true,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "ClientAccount_pkey" PRIMARY KEY ("id")
    );
  `)
  await safeExecuteCompatSql(`CREATE UNIQUE INDEX IF NOT EXISTS "ClientAccount_name_key" ON "ClientAccount"("name");`)

  // Proveedores: crea tabla si falta.
  await safeExecuteCompatSql(`
    CREATE TABLE IF NOT EXISTS "Supplier" (
      "id" TEXT NOT NULL DEFAULT md5(random()::text || clock_timestamp()::text),
      "name" TEXT NOT NULL,
      "serviceType" TEXT NOT NULL DEFAULT '',
      "paymentMethod" TEXT NOT NULL DEFAULT '',
      "paymentTerms" TEXT NOT NULL DEFAULT '',
      "address" TEXT NOT NULL DEFAULT '',
      "mapsUrl" TEXT NOT NULL DEFAULT '',
      "contactName" TEXT NOT NULL DEFAULT '',
      "contactPhone" TEXT NOT NULL DEFAULT '',
      "contactEmail" TEXT NOT NULL DEFAULT '',
      "notes" TEXT NOT NULL DEFAULT '',
      "isActive" BOOLEAN NOT NULL DEFAULT true,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
    );
  `)
  await safeExecuteCompatSql(`CREATE UNIQUE INDEX IF NOT EXISTS "Supplier_name_key" ON "Supplier"("name");`)

  // Suscripciones de notificaciones push (Web Push): crea tabla si falta.
  await safeExecuteCompatSql(`
    CREATE TABLE IF NOT EXISTS "PushSubscription" (
      "id" TEXT NOT NULL DEFAULT md5(random()::text || clock_timestamp()::text),
      "userId" TEXT NOT NULL,
      "endpoint" TEXT NOT NULL,
      "p256dh" TEXT NOT NULL,
      "auth" TEXT NOT NULL,
      "userAgent" TEXT NOT NULL DEFAULT '',
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
    );
  `)
  await safeExecuteCompatSql(
    `CREATE UNIQUE INDEX IF NOT EXISTS "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");`,
  )
  await safeExecuteCompatSql(`CREATE INDEX IF NOT EXISTS "PushSubscription_userId_idx" ON "PushSubscription"("userId");`)

  // Facturas: una factura puede cubrir varios items de inventario (inventoryItemIds)
  // y/o quedar vinculada a una reparacion puntual (repairId).
  await safeExecuteCompatSql(`
    CREATE TABLE IF NOT EXISTS "Invoice" (
      "id" TEXT NOT NULL DEFAULT md5(random()::text || clock_timestamp()::text),
      "code" TEXT NOT NULL,
      "providerName" TEXT NOT NULL,
      "supplierId" TEXT,
      "invoiceNumber" TEXT NOT NULL DEFAULT '',
      "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
      "currency" TEXT NOT NULL DEFAULT 'ARS',
      "issuedAt" TIMESTAMP(3),
      "notes" TEXT NOT NULL DEFAULT '',
      "fileName" TEXT NOT NULL DEFAULT '',
      "fileBase64" TEXT NOT NULL DEFAULT '',
      "fileUrl" TEXT NOT NULL DEFAULT '',
      "repairId" TEXT,
      "inventoryItemIds" JSONB NOT NULL DEFAULT '[]'::jsonb,
      "inventoryItemQuantities" JSONB NOT NULL DEFAULT '{}'::jsonb,
      "createdByUserId" TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
    );
  `)
  await safeExecuteCompatSql(`ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "supplierId" TEXT;`)
  await safeExecuteCompatSql(
    `ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "inventoryItemQuantities" JSONB NOT NULL DEFAULT '{}'::jsonb;`,
  )
  await safeExecuteCompatSql(`CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_code_key" ON "Invoice"("code");`)
  await safeExecuteCompatSql(`CREATE INDEX IF NOT EXISTS "Invoice_repairId_idx" ON "Invoice"("repairId");`)
  await safeExecuteCompatSql(`CREATE INDEX IF NOT EXISTS "Invoice_supplierId_idx" ON "Invoice"("supplierId");`)
  // Permite adjuntar una factura de repuestos directo a una unidad, sin pasar
  // por una nota de pedido/OT — antes solo se podia vincular via reparacion.
  await safeExecuteCompatSql(`ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "unitId" TEXT;`)
  await safeExecuteCompatSql(`CREATE INDEX IF NOT EXISTS "Invoice_unitId_idx" ON "Invoice"("unitId");`)

  // Telemetria/GPS: ingesta de proveedores externos (RSV, Microtrack, etc.) via
  // webhook. TelemetryDevice = equipo GPS del proveedor (deviceExternalId+provider,
  // opcionalmente vinculado a una unidad); TelemetryPosition = historico de puntos,
  // nunca se pisa. IMPORTANTE: ambas tablas estan en COMPAT_TABLE_NAMES arriba —
  // si se agrega una columna nueva a estos modelos en el futuro, safeExecuteCompatSql
  // ya las qualifica solo, no hace falta el patron de qualificar el schema a mano.
  await safeExecuteCompatSql(`
    CREATE TABLE IF NOT EXISTS "TelemetryDevice" (
      "id" TEXT NOT NULL DEFAULT md5(random()::text || clock_timestamp()::text),
      "deviceExternalId" TEXT NOT NULL,
      "provider" TEXT NOT NULL,
      "imei" TEXT,
      "unitId" TEXT,
      "lastSeenAt" TIMESTAMP(3),
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "TelemetryDevice_pkey" PRIMARY KEY ("id")
    );
  `)
  await safeExecuteCompatSql(
    `CREATE UNIQUE INDEX IF NOT EXISTS "TelemetryDevice_deviceExternalId_provider_key" ON "TelemetryDevice"("deviceExternalId", "provider");`,
  )
  await safeExecuteCompatSql(`CREATE INDEX IF NOT EXISTS "TelemetryDevice_unitId_idx" ON "TelemetryDevice"("unitId");`)

  await safeExecuteCompatSql(`
    CREATE TABLE IF NOT EXISTS "TelemetryPosition" (
      "id" TEXT NOT NULL DEFAULT md5(random()::text || clock_timestamp()::text),
      "deviceId" TEXT NOT NULL,
      "capturedAt" TIMESTAMP(3) NOT NULL,
      "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "latitude" DOUBLE PRECISION NOT NULL,
      "longitude" DOUBLE PRECISION NOT NULL,
      "speedKph" DOUBLE PRECISION,
      "heading" DOUBLE PRECISION,
      "altitudeM" DOUBLE PRECISION,
      "accuracyM" DOUBLE PRECISION,
      "odometerKm" DOUBLE PRECISION,
      "fuelLevelPct" DOUBLE PRECISION,
      "engineOn" BOOLEAN,
      "dtcCodes" JSONB,
      "rawPayload" JSONB,
      CONSTRAINT "TelemetryPosition_pkey" PRIMARY KEY ("id")
    );
  `)
  await safeExecuteCompatSql(
    `CREATE INDEX IF NOT EXISTS "TelemetryPosition_deviceId_capturedAt_idx" ON "TelemetryPosition"("deviceId", "capturedAt");`,
  )
  await safeExecuteCompatSql(`CREATE INDEX IF NOT EXISTS "TelemetryPosition_capturedAt_idx" ON "TelemetryPosition"("capturedAt");`)

  // Si Supplier existe legacy, asegura columnas nuevas.
  await safeExecuteCompatSql(`ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "paymentMethod" TEXT NOT NULL DEFAULT '';`)
  await safeExecuteCompatSql(`ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "paymentTerms" TEXT NOT NULL DEFAULT '';`)
  await safeExecuteCompatSql(`ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "address" TEXT NOT NULL DEFAULT '';`)
  await safeExecuteCompatSql(`ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "mapsUrl" TEXT NOT NULL DEFAULT '';`)

  // Entregas/devoluciones: crea tabla si falta (tipos en TEXT para compatibilidad).
  await safeExecuteCompatSql(`
    CREATE TABLE IF NOT EXISTS "DeliveryOperation" (
      "id" TEXT NOT NULL DEFAULT md5(random()::text || clock_timestamp()::text),
      "unitId" TEXT NOT NULL,
      "clientId" TEXT,
      "operationType" TEXT NOT NULL,
      "targetLogisticsStatus" TEXT NOT NULL,
      "summary" TEXT NOT NULL DEFAULT '',
      "reason" TEXT NOT NULL DEFAULT '',
      "remitoFileName" TEXT NOT NULL DEFAULT '',
      "remitoFileUrl" TEXT NOT NULL DEFAULT '',
      "remitoAttachedAt" TIMESTAMP(3),
      "remitoAttachedByUserName" TEXT NOT NULL DEFAULT '',
      "requestedByUserId" TEXT,
      "requestedByUserName" TEXT NOT NULL DEFAULT '',
      "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "DeliveryOperation_pkey" PRIMARY KEY ("id")
    );
  `)
  await safeExecuteCompatSql(
    `CREATE INDEX IF NOT EXISTS "DeliveryOperation_unitId_createdAt_idx" ON "DeliveryOperation"("unitId","createdAt");`,
  )
  await safeExecuteCompatSql(
    `CREATE INDEX IF NOT EXISTS "DeliveryOperation_clientId_createdAt_idx" ON "DeliveryOperation"("clientId","createdAt");`,
  )
  await safeExecuteCompatSql(
    `CREATE INDEX IF NOT EXISTS "DeliveryOperation_operationType_createdAt_idx" ON "DeliveryOperation"("operationType","createdAt");`,
  )
  await safeExecuteCompatSql(
    `ALTER TABLE "DeliveryOperation" ADD COLUMN IF NOT EXISTS "remitoFileName" TEXT NOT NULL DEFAULT '';`,
  )
  await safeExecuteCompatSql(
    `ALTER TABLE "DeliveryOperation" ADD COLUMN IF NOT EXISTS "remitoFileUrl" TEXT NOT NULL DEFAULT '';`,
  )
  await safeExecuteCompatSql(
    `ALTER TABLE "DeliveryOperation" ADD COLUMN IF NOT EXISTS "remitoAttachedAt" TIMESTAMP(3);`,
  )
  await safeExecuteCompatSql(
    `ALTER TABLE "DeliveryOperation" ADD COLUMN IF NOT EXISTS "remitoAttachedByUserName" TEXT NOT NULL DEFAULT '';`,
  )

  // CRM Comercial: tipos y tablas base para embudo y actividades.
  // Nota: el check usa pg_namespace para asegurar que el tipo exista en el schema
  // activo y no solo en public, evitando que ALTER TABLE falle al referenciar el tipo.
  // Crea los tipos enum en el esquema activo usando el nombre desde TypeScript,
  // evitando depender de current_schema() en SQL (que puede resolver a public si el tipo ya existe allí).
  await safeCreateEnumType('CurrencyCode', ['ARS', 'USD'])
  await safeCreateEnumType('CrmDealStage', ['LEAD', 'CONTACTED', 'QUALIFICATION', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'])
  await safeCreateEnumType('CrmDealKind', ['TENDER', 'CONTRACT'])
  await safeCreateEnumType('CrmActivityType', ['CALL', 'WHATSAPP', 'EMAIL', 'MEETING', 'TASK'])
  await safeCreateEnumType('CrmActivityStatus', ['PENDING', 'DONE'])
  await safeCreateEnumType('CrmDealUnitStatus', ['EN_CONCURSO', 'ADJUDICADA', 'PERDIDA', 'LIBERADA'])
  // Si la tabla ya existe con columnas enum apuntando al schema incorrecto (ej: public),
  // las migramos al schema activo antes de crear/alterar la tabla.
  await safeFixEnumColumn('CrmDeal', 'stage', 'CrmDealStage', 'LEAD')
  await safeFixEnumColumn('CrmDeal', 'dealKind', 'CrmDealKind', 'TENDER')
  await safeFixEnumColumn('CrmDeal', 'currency', 'CurrencyCode', 'ARS')
  await safeFixEnumColumn('CrmActivity', 'type', 'CrmActivityType')
  await safeFixEnumColumn('CrmActivity', 'status', 'CrmActivityStatus', 'PENDING')
  await safeFixEnumColumn('CrmDealUnit', 'status', 'CrmDealUnitStatus', 'EN_CONCURSO')
  await safeExecuteCompatSql(`
    CREATE TABLE IF NOT EXISTS "CrmDeal" (
      "id" TEXT NOT NULL DEFAULT md5(random()::text || clock_timestamp()::text),
      "title" TEXT NOT NULL,
      "companyName" TEXT NOT NULL,
      "dealKind" "CrmDealKind" NOT NULL DEFAULT 'TENDER',
      "referenceCode" TEXT NOT NULL DEFAULT '',
      "isHistorical" BOOLEAN NOT NULL DEFAULT false,
      "contactName" TEXT NOT NULL DEFAULT '',
      "contactEmail" TEXT NOT NULL DEFAULT '',
      "contactPhone" TEXT NOT NULL DEFAULT '',
      "source" TEXT NOT NULL DEFAULT '',
      "serviceLine" TEXT NOT NULL DEFAULT '',
      "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
      "currency" "CurrencyCode" NOT NULL DEFAULT 'ARS',
      "probability" INTEGER NOT NULL DEFAULT 10,
      "stage" "CrmDealStage" NOT NULL DEFAULT 'LEAD',
      "expectedCloseDate" TIMESTAMP(3),
      "lastContactAt" TIMESTAMP(3),
	      "lostReason" TEXT NOT NULL DEFAULT '',
	      "notes" TEXT NOT NULL DEFAULT '',
	      "assignedToUserId" TEXT,
	      "convertedClientId" TEXT,
	      "createdByUserId" TEXT NOT NULL,
	      "wonAt" TIMESTAMP(3),
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "CrmDeal_pkey" PRIMARY KEY ("id")
    );
  `)
  await safeExecuteCompatSql(`ALTER TABLE "CrmDeal" ADD COLUMN IF NOT EXISTS "dealKind" "CrmDealKind" NOT NULL DEFAULT 'TENDER';`)
  await safeExecuteCompatSql(`ALTER TABLE "CrmDeal" ADD COLUMN IF NOT EXISTS "referenceCode" TEXT NOT NULL DEFAULT '';`)
  await safeExecuteCompatSql(`ALTER TABLE "CrmDeal" ADD COLUMN IF NOT EXISTS "isHistorical" BOOLEAN NOT NULL DEFAULT false;`)
  await safeExecuteCompatSql(`
    CREATE TABLE IF NOT EXISTS "CrmActivity" (
      "id" TEXT NOT NULL DEFAULT md5(random()::text || clock_timestamp()::text),
      "dealId" TEXT NOT NULL,
      "type" "CrmActivityType" NOT NULL,
      "status" "CrmActivityStatus" NOT NULL DEFAULT 'PENDING',
      "summary" TEXT NOT NULL,
      "dueAt" TIMESTAMP(3),
      "completedAt" TIMESTAMP(3),
      "createdByUserId" TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "CrmActivity_pkey" PRIMARY KEY ("id")
    );
  `)
  await safeExecuteCompatSql(`
    CREATE TABLE IF NOT EXISTS "CrmDealUnit" (
      "id" TEXT NOT NULL DEFAULT md5(random()::text || clock_timestamp()::text),
      "dealId" TEXT NOT NULL,
      "unitId" TEXT NOT NULL,
      "status" "CrmDealUnitStatus" NOT NULL DEFAULT 'EN_CONCURSO',
      "notes" TEXT NOT NULL DEFAULT '',
      "createdByUserId" TEXT NOT NULL,
      "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "releasedAt" TIMESTAMP(3),
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "CrmDealUnit_pkey" PRIMARY KEY ("id")
    );
  `)
	  await safeExecuteCompatSql(`CREATE INDEX IF NOT EXISTS "CrmDeal_stage_createdAt_idx" ON "CrmDeal"("stage","createdAt");`)
	  await safeExecuteCompatSql(
	    `CREATE INDEX IF NOT EXISTS "CrmDeal_assignedToUserId_stage_idx" ON "CrmDeal"("assignedToUserId","stage");`,
	  )
	  await safeExecuteCompatSql(`ALTER TABLE "CrmDeal" ADD COLUMN IF NOT EXISTS "convertedClientId" TEXT;`)
	  await safeExecuteCompatSql(`CREATE INDEX IF NOT EXISTS "CrmDeal_convertedClientId_idx" ON "CrmDeal"("convertedClientId");`)
	  await safeExecuteCompatSql(`CREATE INDEX IF NOT EXISTS "CrmDeal_companyName_idx" ON "CrmDeal"("companyName");`)
	  await safeExecuteCompatSql(`CREATE INDEX IF NOT EXISTS "CrmDeal_dealKind_stage_idx" ON "CrmDeal"("dealKind","stage");`)
  await safeExecuteCompatSql(
    `CREATE INDEX IF NOT EXISTS "CrmActivity_dealId_status_dueAt_idx" ON "CrmActivity"("dealId","status","dueAt");`,
  )
  await safeExecuteCompatSql(
    `CREATE INDEX IF NOT EXISTS "CrmActivity_createdByUserId_createdAt_idx" ON "CrmActivity"("createdByUserId","createdAt");`,
  )
  await safeExecuteCompatSql(
    `CREATE UNIQUE INDEX IF NOT EXISTS "CrmDealUnit_dealId_unitId_key" ON "CrmDealUnit"("dealId","unitId");`,
  )
  await safeExecuteCompatSql(
    `CREATE INDEX IF NOT EXISTS "CrmDealUnit_dealId_status_idx" ON "CrmDealUnit"("dealId","status");`,
  )
  await safeExecuteCompatSql(
    `CREATE INDEX IF NOT EXISTS "CrmDealUnit_unitId_status_idx" ON "CrmDealUnit"("unitId","status");`,
  )
	  await safeExecuteCompatSql(`
	    DO $$
	    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'CrmDeal_assignedToUserId_fkey'
      ) THEN
        ALTER TABLE "CrmDeal"
          ADD CONSTRAINT "CrmDeal_assignedToUserId_fkey"
          FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id")
          ON DELETE SET NULL ON UPDATE CASCADE;
      END IF;
    END
	    $$;
	  `)
	  await safeExecuteCompatSql(`
	    DO $$
	    BEGIN
	      IF NOT EXISTS (
	        SELECT 1 FROM pg_constraint WHERE conname = 'CrmDeal_convertedClientId_fkey'
	      ) THEN
	        ALTER TABLE "CrmDeal"
	          ADD CONSTRAINT "CrmDeal_convertedClientId_fkey"
	          FOREIGN KEY ("convertedClientId") REFERENCES "ClientAccount"("id")
	          ON DELETE SET NULL ON UPDATE CASCADE;
	      END IF;
	    END
	    $$;
	  `)
	  await safeExecuteCompatSql(`
	    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'CrmDeal_createdByUserId_fkey'
      ) THEN
        ALTER TABLE "CrmDeal"
          ADD CONSTRAINT "CrmDeal_createdByUserId_fkey"
          FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
          ON DELETE RESTRICT ON UPDATE CASCADE;
      END IF;
    END
    $$;
  `)
  await safeExecuteCompatSql(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'CrmActivity_dealId_fkey'
      ) THEN
        ALTER TABLE "CrmActivity"
          ADD CONSTRAINT "CrmActivity_dealId_fkey"
          FOREIGN KEY ("dealId") REFERENCES "CrmDeal"("id")
          ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
    END
    $$;
  `)
  await safeExecuteCompatSql(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'CrmActivity_createdByUserId_fkey'
      ) THEN
        ALTER TABLE "CrmActivity"
          ADD CONSTRAINT "CrmActivity_createdByUserId_fkey"
          FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
          ON DELETE RESTRICT ON UPDATE CASCADE;
      END IF;
    END
    $$;
  `)
  await safeExecuteCompatSql(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'CrmDealUnit_dealId_fkey'
      ) THEN
        ALTER TABLE "CrmDealUnit"
          ADD CONSTRAINT "CrmDealUnit_dealId_fkey"
          FOREIGN KEY ("dealId") REFERENCES "CrmDeal"("id")
          ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
    END
    $$;
  `)
  await safeExecuteCompatSql(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'CrmDealUnit_unitId_fkey'
      ) THEN
        ALTER TABLE "CrmDealUnit"
          ADD CONSTRAINT "CrmDealUnit_unitId_fkey"
          FOREIGN KEY ("unitId") REFERENCES "FleetUnit"("id")
          ON DELETE CASCADE ON UPDATE CASCADE;
      END IF;
    END
    $$;
  `)
  await safeExecuteCompatSql(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'CrmDealUnit_createdByUserId_fkey'
      ) THEN
        ALTER TABLE "CrmDealUnit"
          ADD CONSTRAINT "CrmDealUnit_createdByUserId_fkey"
          FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
          ON DELETE RESTRICT ON UPDATE CASCADE;
      END IF;
    END
    $$;
  `)

  // Contratos de alquiler: vencimientos por unidad/cliente (modulo en prueba, DEV-only).
  // IMPORTANTE: "CurrencyCode" sin calificar se resuelve por el search_path de la
  // conexion (que no necesariamente es el schema activo, ver current_schema() mas
  // arriba) y puede terminar apuntando a un tipo con el mismo nombre en OTRO schema
  // (ej. public) — distinto del que usa el resto de la app. Por eso se qualifica
  // el tipo a mano con el schema activo real, igual que ya se hace con las tablas.
  {
    const contractSchema = quoteIdentifier(getNormalizedActiveSchema())
    await safeExecuteCompatSql(`
      CREATE TABLE IF NOT EXISTS "RentalContract" (
        "id" TEXT NOT NULL DEFAULT md5(random()::text || clock_timestamp()::text),
        "code" TEXT NOT NULL DEFAULT '',
        "unitId" TEXT NOT NULL,
        "clientId" TEXT,
        "clientName" TEXT NOT NULL DEFAULT '',
        "startDate" TIMESTAMP(3) NOT NULL,
        "endDate" TIMESTAMP(3) NOT NULL,
        "monthlyValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "currency" ${contractSchema}."CurrencyCode" NOT NULL DEFAULT 'ARS',
        "status" TEXT NOT NULL DEFAULT 'ACTIVE',
        "notes" TEXT NOT NULL DEFAULT '',
        "expirationAlertSentAt" TIMESTAMP(3),
        "createdByUserId" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "RentalContract_pkey" PRIMARY KEY ("id")
      );
    `)
    await safeExecuteCompatSql(`ALTER TABLE "RentalContract" ALTER COLUMN "currency" DROP DEFAULT;`)
    await safeExecuteCompatSql(
      `ALTER TABLE "RentalContract" ALTER COLUMN "currency" TYPE ${contractSchema}."CurrencyCode" USING ("currency"::text::${contractSchema}."CurrencyCode");`,
    )
    await safeExecuteCompatSql(
      `ALTER TABLE "RentalContract" ALTER COLUMN "currency" SET DEFAULT 'ARS'::${contractSchema}."CurrencyCode";`,
    )
  }
  await safeExecuteCompatSql(`CREATE INDEX IF NOT EXISTS "RentalContract_unitId_idx" ON "RentalContract"("unitId");`)
  await safeExecuteCompatSql(`CREATE INDEX IF NOT EXISTS "RentalContract_clientId_idx" ON "RentalContract"("clientId");`)
  await safeExecuteCompatSql(`CREATE INDEX IF NOT EXISTS "RentalContract_endDate_idx" ON "RentalContract"("endDate");`)

  // Checklist de entrega/devolucion de equipos (modulo en prueba, DEV-only).
  // "type" queda en TEXT a proposito (no enum nativo de Postgres) — un enum sin
  // calificar aca ya nos mordio una vez con RentalContract.currency (ver arriba),
  // asi que para un campo de 2 valores fijos no vale la pena el riesgo.
  await safeExecuteCompatSql(`
    CREATE TABLE IF NOT EXISTS "HandoverChecklist" (
      "id" TEXT NOT NULL DEFAULT md5(random()::text || clock_timestamp()::text),
      "code" TEXT NOT NULL DEFAULT '',
      "type" TEXT NOT NULL,
      "unitId" TEXT NOT NULL,
      "clientId" TEXT,
      "clientName" TEXT NOT NULL DEFAULT '',
      "contractId" TEXT,
      "responsibleName" TEXT NOT NULL DEFAULT '',
      "performedAt" TIMESTAMP(3) NOT NULL,
      "unitKilometers" INTEGER NOT NULL DEFAULT 0,
      "engineHours" INTEGER NOT NULL DEFAULT 0,
      "fuelLevelPct" INTEGER NOT NULL DEFAULT 0,
      "checklist" JSONB NOT NULL DEFAULT '{}'::jsonb,
      "damagesFound" TEXT NOT NULL DEFAULT '',
      "chargeToClientUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
      "photoUrls" JSONB NOT NULL DEFAULT '[]'::jsonb,
      "signedActUrl" TEXT NOT NULL DEFAULT '',
      "observations" TEXT NOT NULL DEFAULT '',
      "createdByUserId" TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "HandoverChecklist_pkey" PRIMARY KEY ("id")
    );
  `)
  await safeExecuteCompatSql(`CREATE INDEX IF NOT EXISTS "HandoverChecklist_unitId_idx" ON "HandoverChecklist"("unitId");`)
  await safeExecuteCompatSql(`CREATE INDEX IF NOT EXISTS "HandoverChecklist_clientId_idx" ON "HandoverChecklist"("clientId");`)
  await safeExecuteCompatSql(
    `CREATE INDEX IF NOT EXISTS "HandoverChecklist_type_performedAt_idx" ON "HandoverChecklist"("type", "performedAt");`,
  )

  // Cubiertas (modulo en prueba, DEV-only). "currency" en TEXT, no enum, misma
  // razon que HandoverChecklist.type.
  await safeExecuteCompatSql(`
    CREATE TABLE IF NOT EXISTS "Tire" (
      "id" TEXT NOT NULL DEFAULT md5(random()::text || clock_timestamp()::text),
      "unitId" TEXT NOT NULL,
      "position" TEXT NOT NULL,
      "brand" TEXT NOT NULL DEFAULT '',
      "model" TEXT NOT NULL DEFAULT '',
      "installedAt" TIMESTAMP(3),
      "installedKm" INTEGER NOT NULL DEFAULT 0,
      "lastRotationKm" INTEGER,
      "costBase" DOUBLE PRECISION NOT NULL DEFAULT 0,
      "currency" TEXT NOT NULL DEFAULT 'ARS',
      "notes" TEXT NOT NULL DEFAULT '',
      "isActive" BOOLEAN NOT NULL DEFAULT true,
      "removedAt" TIMESTAMP(3),
      "wearAlertSentAt" TIMESTAMP(3),
      "createdByUserId" TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "Tire_pkey" PRIMARY KEY ("id")
    );
  `)
  await safeExecuteCompatSql(`CREATE INDEX IF NOT EXISTS "Tire_unitId_idx" ON "Tire"("unitId");`)
  await safeExecuteCompatSql(`CREATE INDEX IF NOT EXISTS "Tire_isActive_idx" ON "Tire"("isActive");`)

  // Viajes/traslados de choferes (modulo en prueba, DEV-only). Sin enums nativos,
  // misma razon que HandoverChecklist.type.
  await safeExecuteCompatSql(`
    CREATE TABLE IF NOT EXISTS "Trip" (
      "id" TEXT NOT NULL DEFAULT md5(random()::text || clock_timestamp()::text),
      "code" TEXT NOT NULL DEFAULT '',
      "driverUserId" TEXT,
      "driverExternalName" TEXT NOT NULL DEFAULT '',
      "unitId" TEXT,
      "startDate" TIMESTAMP(3) NOT NULL,
      "endDate" TIMESTAMP(3) NOT NULL,
      "originLabel" TEXT NOT NULL DEFAULT '',
      "originLat" DOUBLE PRECISION NOT NULL,
      "originLng" DOUBLE PRECISION NOT NULL,
      "destinationLabel" TEXT NOT NULL DEFAULT '',
      "destinationLat" DOUBLE PRECISION NOT NULL,
      "destinationLng" DOUBLE PRECISION NOT NULL,
      "distanceKm" DOUBLE PRECISION NOT NULL DEFAULT 0,
      "distanceSource" TEXT NOT NULL DEFAULT 'ROUTE',
      "notes" TEXT NOT NULL DEFAULT '',
      "createdByUserId" TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "Trip_pkey" PRIMARY KEY ("id")
    );
  `)
  await safeExecuteCompatSql(`CREATE INDEX IF NOT EXISTS "Trip_driverUserId_idx" ON "Trip"("driverUserId");`)
  await safeExecuteCompatSql(`CREATE INDEX IF NOT EXISTS "Trip_unitId_idx" ON "Trip"("unitId");`)
  await safeExecuteCompatSql(`CREATE INDEX IF NOT EXISTS "Trip_startDate_idx" ON "Trip"("startDate");`)

  // Un viaje pasa a tener varios tramos (ida, vuelta, o mas paradas), cada uno
  // con su propia unidad (el chofer puede volver con un camion distinto al
  // que llevo) — se relajan las columnas viejas de ubicacion/unidad de Trip
  // (ya no se completan para viajes nuevos) y se agrega TripLeg.
  await safeExecuteCompatSql(`ALTER TABLE "Trip" ALTER COLUMN "originLat" DROP NOT NULL;`)
  await safeExecuteCompatSql(`ALTER TABLE "Trip" ALTER COLUMN "originLng" DROP NOT NULL;`)
  await safeExecuteCompatSql(`ALTER TABLE "Trip" ALTER COLUMN "destinationLat" DROP NOT NULL;`)
  await safeExecuteCompatSql(`ALTER TABLE "Trip" ALTER COLUMN "destinationLng" DROP NOT NULL;`)

  await safeExecuteCompatSql(`
    CREATE TABLE IF NOT EXISTS "TripLeg" (
      "id" TEXT NOT NULL DEFAULT md5(random()::text || clock_timestamp()::text),
      "tripId" TEXT NOT NULL,
      "order" INTEGER NOT NULL DEFAULT 1,
      "label" TEXT NOT NULL DEFAULT '',
      "unitId" TEXT,
      "startDate" TIMESTAMP(3) NOT NULL,
      "endDate" TIMESTAMP(3) NOT NULL,
      "originLabel" TEXT NOT NULL DEFAULT '',
      "originLat" DOUBLE PRECISION NOT NULL,
      "originLng" DOUBLE PRECISION NOT NULL,
      "destinationLabel" TEXT NOT NULL DEFAULT '',
      "destinationLat" DOUBLE PRECISION NOT NULL,
      "destinationLng" DOUBLE PRECISION NOT NULL,
      "distanceKm" DOUBLE PRECISION NOT NULL DEFAULT 0,
      "distanceSource" TEXT NOT NULL DEFAULT 'ROUTE',
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "TripLeg_pkey" PRIMARY KEY ("id")
    );
  `)
  await safeExecuteCompatSql(`CREATE INDEX IF NOT EXISTS "TripLeg_tripId_idx" ON "TripLeg"("tripId");`)
  await safeExecuteCompatSql(`CREATE INDEX IF NOT EXISTS "TripLeg_unitId_idx" ON "TripLeg"("unitId");`)

  // Migracion unica de los viajes viejos (un solo tramo inline) a TripLeg,
  // como tramo "Ida". Idempotente: solo inserta si el viaje todavia no tiene
  // ningun tramo cargado.
  await safeExecuteCompatSql(`
    INSERT INTO "TripLeg" ("tripId", "order", "label", "unitId", "startDate", "endDate", "originLabel", "originLat", "originLng", "destinationLabel", "destinationLat", "destinationLng", "distanceKm", "distanceSource")
    SELECT t."id", 1, 'Ida', t."unitId", t."startDate", t."endDate", t."originLabel", t."originLat", t."originLng", t."destinationLabel", t."destinationLat", t."destinationLng", t."distanceKm", t."distanceSource"
    FROM "Trip" t
    WHERE t."originLat" IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM "TripLeg" tl WHERE tl."tripId" = t."id");
  `)

  // Inventario: campos que el frontend ya usaba pero nunca se habian agregado al schema real
  // (externalBarcode/unit/unitPrice/currency se perdian al guardar) + descripcion legible del producto.
  const hasInventoryItemTable = await tableExistsInActiveSchema('InventoryItem')
  if (hasInventoryItemTable) {
    const inventorySchema = quoteIdentifier(getNormalizedActiveSchema())
    for (const [col, type] of [
      ['externalBarcode', 'TEXT'],
      ['description', `TEXT NOT NULL DEFAULT ''`],
      ['unit', `TEXT NOT NULL DEFAULT 'UNIDAD'`],
      ['unitPrice', 'DOUBLE PRECISION'],
      ['currency', `TEXT NOT NULL DEFAULT 'ARS'`],
    ] as const) {
      try {
        await prisma.$executeRawUnsafe(`ALTER TABLE ${inventorySchema}."InventoryItem" ADD COLUMN IF NOT EXISTS "${col}" ${type}`)
      } catch (err) {
        console.warn(`[DB] ADD COLUMN InventoryItem.${col}:`, err)
      }
    }
    // El frontend permite stock fraccionario (litros/kg/metros); la columna original era entera.
    try {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE ${inventorySchema}."InventoryItem" ALTER COLUMN "stock" TYPE DOUBLE PRECISION USING "stock"::double precision`,
      )
    } catch (err) {
      console.warn('[DB] ALTER COLUMN InventoryItem.stock:', err)
    }
  }

  // Plan de mantenimiento: tipo de mantenimiento (un plan = un sistema puntual) + intervalo
  // de service (en vez de que el usuario tenga que escribir a mano el proximo service
  // absoluto, que al borrarse quedaba en 0 y rompia el calculo de estado).
  const hasMaintenancePlanTable = await tableExistsInActiveSchema('MaintenancePlan')
  if (hasMaintenancePlanTable) {
    const maintenanceSchema = quoteIdentifier(getNormalizedActiveSchema())
    for (const [col, type] of [
      ['maintenanceType', `TEXT NOT NULL DEFAULT 'MOTOR'`],
      ['serviceIntervalKilometers', 'INTEGER'],
      ['serviceIntervalHours', 'INTEGER'],
    ] as const) {
      try {
        await prisma.$executeRawUnsafe(
          `ALTER TABLE ${maintenanceSchema}."MaintenancePlan" ADD COLUMN IF NOT EXISTS "${col}" ${type}`,
        )
      } catch (err) {
        console.warn(`[DB] ADD COLUMN MaintenancePlan.${col}:`, err)
      }
    }
  }

  // Tareas: asignacion a terceros sin usuario del sistema + fechas de plan (inicio/fin aprox)
  // + chat/notas por tarea (TaskEvent tipo COMMENT) + registro de "visto" por el asignado
  // + tipo de tarea y vinculacion a una unidad de flota.
  const hasTaskTable = await tableExistsInActiveSchema('Task')
  if (hasTaskTable) {
    const taskSchema = quoteIdentifier(getNormalizedActiveSchema())
    for (const [col, type] of [
      ['assignedToExternalName', `TEXT NOT NULL DEFAULT ''`],
      ['startDate', 'TIMESTAMP(3)'],
      ['estimatedFinishDate', 'TIMESTAMP(3)'],
      ['viewedAt', 'TIMESTAMP(3)'],
      ['viewedByUserId', 'TEXT'],
      ['type', `TEXT NOT NULL DEFAULT 'OTRA'`],
      ['unitId', 'TEXT'],
    ] as const) {
      try {
        await prisma.$executeRawUnsafe(`ALTER TABLE ${taskSchema}."Task" ADD COLUMN IF NOT EXISTS "${col}" ${type}`)
      } catch (err) {
        console.warn(`[DB] ADD COLUMN Task.${col}:`, err)
      }
    }
    try {
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Task_unitId_idx" ON ${taskSchema}."Task"("unitId")`)
    } catch (err) {
      console.warn('[DB] CREATE INDEX Task_unitId_idx:', err)
    }
  }
  const hasTaskEventTable = await tableExistsInActiveSchema('TaskEvent')
  if (hasTaskEventTable) {
    await safeAddEnumValue('TaskEventType', 'COMMENT')
    await safeAddEnumValue('TaskEventType', 'VIEWED')
  }

  // Remitos: vinculo opcional a Cliente real (antes solo texto libre, generaba
  // duplicados/typos que no cruzaban con el modulo Clientes).
  // OJO: FleetMovement no esta en COMPAT_TABLE_NAMES, asi que safeExecuteCompatSql
  // (que solo qualifica esa lista de tablas) NO le agrega el prefijo de schema y la
  // sentencia termina corriendo contra el schema por default de la conexion en vez
  // del schema activo real — exactamente el bug que dejo esta columna sin crear en
  // produccion en silencio. Por eso acá se qualifica el schema a mano, igual que
  // ya se hace para MaintenancePlan/Task/InventoryItem mas abajo/arriba.
  const hasFleetMovementTable = await tableExistsInActiveSchema('FleetMovement')
  if (hasFleetMovementTable) {
    const movementSchema = quoteIdentifier(getNormalizedActiveSchema())
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE ${movementSchema}."FleetMovement" ADD COLUMN IF NOT EXISTS "clientId" TEXT`)
    } catch (err) {
      console.warn('[DB] ADD COLUMN FleetMovement.clientId:', err)
    }
    try {
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS "FleetMovement_clientId_idx" ON ${movementSchema}."FleetMovement"("clientId")`,
      )
    } catch (err) {
      console.warn('[DB] CREATE INDEX FleetMovement_clientId_idx:', err)
    }
  }

  // NDP/Reparaciones: solo aplica cambios si tablas existen en schema activo.
  const hasExternalRequestTable = await tableExistsInActiveSchema('ExternalRequest')
  const hasRepairRecordTable = await tableExistsInActiveSchema('RepairRecord')

  if (hasExternalRequestTable) {
    await safeExecuteCompatSql(`ALTER TABLE "ExternalRequest" ADD COLUMN IF NOT EXISTS "companyName" TEXT NOT NULL DEFAULT '';`)
    await safeExecuteCompatSql(`ALTER TABLE "ExternalRequest" ADD COLUMN IF NOT EXISTS "providerFileName" TEXT NOT NULL DEFAULT '';`)
    await safeExecuteCompatSql(`ALTER TABLE "ExternalRequest" ADD COLUMN IF NOT EXISTS "providerFileUrl" TEXT NOT NULL DEFAULT '';`)
    await safeExecuteCompatSql(`ALTER TABLE "ExternalRequest" ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'ARS';`)
    await safeExecuteCompatSql(
      `ALTER TABLE "ExternalRequest" ADD COLUMN IF NOT EXISTS "partsItems" JSONB NOT NULL DEFAULT '[]'::jsonb;`,
    )
    await safeExecuteCompatSql(
      `ALTER TABLE "ExternalRequest" ADD COLUMN IF NOT EXISTS "partsTotal" DOUBLE PRECISION NOT NULL DEFAULT 0;`,
    )
    await safeExecuteCompatSql(
      `ALTER TABLE "ExternalRequest" ADD COLUMN IF NOT EXISTS "eligibilityStatus" TEXT NOT NULL DEFAULT 'PENDING_ATTACHMENT';`,
    )
    await safeExecuteCompatSql(`ALTER TABLE "ExternalRequest" ADD COLUMN IF NOT EXISTS "linkedRepairId" TEXT;`)
    await safeExecuteCompatSql(`ALTER TABLE "ExternalRequest" ADD COLUMN IF NOT EXISTS "serviceOrderId" TEXT;`)
    await safeExecuteCompatSql(`ALTER TABLE "ExternalRequest" ADD COLUMN IF NOT EXISTS "ocCode" TEXT;`)
    await safeExecuteCompatSql(`ALTER TABLE "ExternalRequest" ADD COLUMN IF NOT EXISTS "ocGeneratedAt" TIMESTAMP(3);`)
    await safeExecuteCompatSql(
      `CREATE INDEX IF NOT EXISTS "ExternalRequest_linkedRepairId_idx" ON "ExternalRequest"("linkedRepairId");`,
    )
    await safeExecuteCompatSql(
      `CREATE INDEX IF NOT EXISTS "ExternalRequest_serviceOrderId_idx" ON "ExternalRequest"("serviceOrderId");`,
    )
  }

  if (hasRepairRecordTable) {
    await safeExecuteCompatSql(
      `ALTER TABLE "RepairRecord" ADD COLUMN IF NOT EXISTS "linkedExternalRequestIds" JSONB NOT NULL DEFAULT '[]'::jsonb;`,
    )
    await safeExecuteCompatSql(
      `ALTER TABLE "RepairRecord" ADD COLUMN IF NOT EXISTS "externalRequestId" TEXT;`,
    )
    await safeExecuteCompatSql(`ALTER TABLE "RepairRecord" ADD COLUMN IF NOT EXISTS "laborCost" DOUBLE PRECISION NOT NULL DEFAULT 0;`)
    await safeExecuteCompatSql(`ALTER TABLE "RepairRecord" ADD COLUMN IF NOT EXISTS "partsCost" DOUBLE PRECISION NOT NULL DEFAULT 0;`)
    await safeExecuteCompatSql(
      `ALTER TABLE "RepairRecord" ADD COLUMN IF NOT EXISTS "partsUsed" JSONB NOT NULL DEFAULT '[]'::jsonb;`,
    )
  }

  if (hasExternalRequestTable) {
    const hasEligibilityStatus = await columnExistsInActiveSchema('ExternalRequest', 'eligibilityStatus')
    const hasProviderFileUrl = await columnExistsInActiveSchema('ExternalRequest', 'providerFileUrl')

    if (hasEligibilityStatus && hasProviderFileUrl) {
      await safeExecuteCompatSql(`
        UPDATE "ExternalRequest"
        SET "eligibilityStatus" = CASE
          WHEN COALESCE("providerFileUrl", '') <> '' THEN 'READY_FOR_REPAIR'
          ELSE 'PENDING_ATTACHMENT'
        END
        WHERE "eligibilityStatus" NOT IN ('PENDING_ATTACHMENT', 'READY_FOR_REPAIR');
      `)
    } else if (hasEligibilityStatus) {
      await safeExecuteCompatSql(`
        UPDATE "ExternalRequest"
        SET "eligibilityStatus" = 'PENDING_ATTACHMENT'
        WHERE "eligibilityStatus" NOT IN ('PENDING_ATTACHMENT', 'READY_FOR_REPAIR');
      `)
    }
  }

  if (hasRepairRecordTable) {
    const hasExternalRequestId = await columnExistsInActiveSchema('RepairRecord', 'externalRequestId')
    const hasLinkedExternalRequestIds = await columnExistsInActiveSchema('RepairRecord', 'linkedExternalRequestIds')
    const hasLaborCost = await columnExistsInActiveSchema('RepairRecord', 'laborCost')
    const hasPartsCost = await columnExistsInActiveSchema('RepairRecord', 'partsCost')
    const hasRealCost = await columnExistsInActiveSchema('RepairRecord', 'realCost')

    if (hasExternalRequestId && hasLinkedExternalRequestIds) {
      await safeExecuteCompatSql(`
        UPDATE "RepairRecord"
        SET "linkedExternalRequestIds" = jsonb_build_array("externalRequestId")
        WHERE COALESCE("externalRequestId", '') <> ''
          AND COALESCE(jsonb_array_length("linkedExternalRequestIds"), 0) = 0;
      `)
    }

    if (hasLaborCost && hasPartsCost && hasRealCost) {
      await safeExecuteCompatSql(`
        UPDATE "RepairRecord"
        SET "laborCost" = COALESCE("realCost", 0)
        WHERE COALESCE("laborCost", 0) = 0
          AND COALESCE("partsCost", 0) = 0;
      `)
    }
  }

  if (hasExternalRequestTable && hasRepairRecordTable) {
    const hasLinkedRepairId = await columnExistsInActiveSchema('ExternalRequest', 'linkedRepairId')
    if (hasLinkedRepairId) {
      await safeExecuteCompatSql(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'ExternalRequest_linkedRepairId_fkey'
          ) THEN
            ALTER TABLE "ExternalRequest"
              ADD CONSTRAINT "ExternalRequest_linkedRepairId_fkey"
              FOREIGN KEY ("linkedRepairId") REFERENCES "RepairRecord"("id")
              ON DELETE SET NULL ON UPDATE CASCADE;
          END IF;
        END
        $$;
      `)
    }
  }
}

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
            `${result.schema}(score=${result.score},fleetUnitRows=${result.fleetUnitRowCount},core=${result.isCoreReady},user=${result.hasUserTable},fleet=${result.hasFleetUnitTable},repair=${result.hasRepairRecordTable},clientId=${result.hasFleetClientIdColumn},supplier=${result.hasSupplierTable},client=${result.hasClientAccountTable},delivery=${result.hasDeliveryOperationTable})`,
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

  const coreReady = filtered.filter((result) => result.isCoreReady)
  if (coreReady.length > 0) {
    return coreReady.sort((a, b) => b.score - a.score)[0] ?? null
  }

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
  // PrismaClientUnknownRequestError from raw Postgres errors:
  // 42704 = undefined_object (type not found), 42p01 = undefined_table
  if (message.includes('42704') || message.includes('42p01')) {
    return true
  }
  return message.includes('does not exist in the current database') || message.includes('table') && message.includes('does not exist')
}

let schemaRecoveryPromise: Promise<boolean> | null = null

const recoverSchemaFromRuntimeError = async (): Promise<boolean> => {
  const results = await probeCandidates()
  if (results.length === 0) {
    return false
  }

  const bestAlternative = pickBestSchema(results, true)
  if (!bestAlternative || bestAlternative.score <= 0 || !bestAlternative.isCoreReady) {
    return false
  }

  const switched = await activateSchema(bestAlternative.schema)
  if (switched) {
    await ensureRuntimeSchemaCompatibility()
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

    // Primero intenta reparar el schema activo y reintentar sin cambiar de schema.
    await ensureRuntimeSchemaCompatibility()
    try {
      return await operation()
    } catch (retryError) {
      if (!isSchemaMismatchError(retryError)) {
        throw retryError
      }
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
    await ensureRuntimeSchemaCompatibility()
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
  await ensureRuntimeSchemaCompatibility()

  console.log(
    `[DB] esquema activo: ${activeSchema} (score ${best.score}, supplier=${best.hasSupplierTable}, client=${best.hasClientAccountTable}, delivery=${best.hasDeliveryOperationTable}, fleet.clientId=${best.hasFleetClientIdColumn})`,
  )
}

export const getActiveDbSchema = (): string => activeSchema
