-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FleetLogisticsStatus') THEN
    CREATE TYPE "FleetLogisticsStatus" AS ENUM ('AVAILABLE', 'PENDING_DELIVERY', 'DELIVERED', 'PENDING_RETURN', 'RETURNED');
  END IF;
END
$$;

-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DeliveryOperationType') THEN
    CREATE TYPE "DeliveryOperationType" AS ENUM ('DELIVERY', 'RETURN');
  END IF;
END
$$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "ClientAccount" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "legalName" TEXT NOT NULL DEFAULT '',
  "taxId" TEXT NOT NULL DEFAULT '',
  "contactName" TEXT NOT NULL DEFAULT '',
  "contactPhone" TEXT NOT NULL DEFAULT '',
  "contactEmail" TEXT NOT NULL DEFAULT '',
  "notes" TEXT NOT NULL DEFAULT '',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClientAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Supplier" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "serviceType" TEXT NOT NULL DEFAULT '',
  "contactName" TEXT NOT NULL DEFAULT '',
  "contactPhone" TEXT NOT NULL DEFAULT '',
  "contactEmail" TEXT NOT NULL DEFAULT '',
  "notes" TEXT NOT NULL DEFAULT '',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DeliveryOperation" (
  "id" TEXT NOT NULL,
  "unitId" TEXT NOT NULL,
  "clientId" TEXT,
  "operationType" "DeliveryOperationType" NOT NULL,
  "targetLogisticsStatus" "FleetLogisticsStatus" NOT NULL,
  "summary" TEXT NOT NULL DEFAULT '',
  "reason" TEXT NOT NULL DEFAULT '',
  "requestedByUserId" TEXT,
  "requestedByUserName" TEXT NOT NULL DEFAULT '',
  "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DeliveryOperation_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "FleetUnit" ADD COLUMN IF NOT EXISTS "clientId" TEXT;
ALTER TABLE "FleetUnit" ADD COLUMN IF NOT EXISTS "logisticsStatus" "FleetLogisticsStatus" NOT NULL DEFAULT 'AVAILABLE';
ALTER TABLE "FleetUnit" ADD COLUMN IF NOT EXISTS "logisticsStatusNote" TEXT NOT NULL DEFAULT '';
ALTER TABLE "FleetUnit" ADD COLUMN IF NOT EXISTS "logisticsUpdatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "RepairRecord" ADD COLUMN IF NOT EXISTS "supplierId" TEXT;

-- Seed clients from existing fleet.clientName
INSERT INTO "ClientAccount" ("id", "name", "createdAt", "updatedAt")
SELECT
  CONCAT('client-', SUBSTRING(MD5(LOWER(TRIM("clientName"))), 1, 16)),
  TRIM("clientName"),
  NOW(),
  NOW()
FROM "FleetUnit"
WHERE TRIM(COALESCE("clientName", '')) <> ''
ON CONFLICT ("name") DO NOTHING;

-- Backfill FleetUnit.clientId from current clientName values
UPDATE "FleetUnit" fu
SET "clientId" = ca."id"
FROM "ClientAccount" ca
WHERE fu."clientId" IS NULL
  AND TRIM(COALESCE(fu."clientName", '')) <> ''
  AND LOWER(TRIM(fu."clientName")) = LOWER(ca."name");

-- Initial logistics status inference for existing units
UPDATE "FleetUnit"
SET "logisticsStatus" = CASE
  WHEN TRIM(COALESCE("clientName", '')) <> '' THEN 'DELIVERED'::"FleetLogisticsStatus"
  ELSE 'AVAILABLE'::"FleetLogisticsStatus"
END;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ClientAccount_name_key" ON "ClientAccount"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "Supplier_name_key" ON "Supplier"("name");
CREATE INDEX IF NOT EXISTS "FleetUnit_clientId_idx" ON "FleetUnit"("clientId");
CREATE INDEX IF NOT EXISTS "FleetUnit_logisticsStatus_idx" ON "FleetUnit"("logisticsStatus");
CREATE INDEX IF NOT EXISTS "RepairRecord_supplierId_idx" ON "RepairRecord"("supplierId");
CREATE INDEX IF NOT EXISTS "DeliveryOperation_unitId_createdAt_idx" ON "DeliveryOperation"("unitId", "createdAt");
CREATE INDEX IF NOT EXISTS "DeliveryOperation_clientId_createdAt_idx" ON "DeliveryOperation"("clientId", "createdAt");
CREATE INDEX IF NOT EXISTS "DeliveryOperation_operationType_createdAt_idx" ON "DeliveryOperation"("operationType", "createdAt");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FleetUnit_clientId_fkey') THEN
    ALTER TABLE "FleetUnit"
      ADD CONSTRAINT "FleetUnit_clientId_fkey"
      FOREIGN KEY ("clientId") REFERENCES "ClientAccount"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RepairRecord_supplierId_fkey') THEN
    ALTER TABLE "RepairRecord"
      ADD CONSTRAINT "RepairRecord_supplierId_fkey"
      FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DeliveryOperation_unitId_fkey') THEN
    ALTER TABLE "DeliveryOperation"
      ADD CONSTRAINT "DeliveryOperation_unitId_fkey"
      FOREIGN KEY ("unitId") REFERENCES "FleetUnit"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DeliveryOperation_clientId_fkey') THEN
    ALTER TABLE "DeliveryOperation"
      ADD CONSTRAINT "DeliveryOperation_clientId_fkey"
      FOREIGN KEY ("clientId") REFERENCES "ClientAccount"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DeliveryOperation_requestedByUserId_fkey') THEN
    ALTER TABLE "DeliveryOperation"
      ADD CONSTRAINT "DeliveryOperation_requestedByUserId_fkey"
      FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;
