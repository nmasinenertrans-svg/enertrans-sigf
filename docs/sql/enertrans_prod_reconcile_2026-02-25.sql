-- ENERTRANS SIGF - Production DB reconciliation (schema: enertrans_prod)
-- Date: 2026-02-25
-- Purpose: Idempotent SQL patches applied manually in production to reconcile schema drift
-- Notes:
--   - Safe to re-run (uses IF NOT EXISTS / guarded DO blocks where possible)
--   - Does NOT remove legacy FleetMovement.unitId FK/column (kept for compatibility)
--   - Does NOT modify _prisma_migrations historical rows (documented separately)

BEGIN;

-- =========================================================
-- 1) FleetUnitType enum: add PICKUP (fix fleet sync failures)
-- =========================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'enertrans_prod'
      AND t.typname = 'FleetUnitType'
      AND e.enumlabel = 'PICKUP'
  ) THEN
    ALTER TYPE "enertrans_prod"."FleetUnitType" ADD VALUE 'PICKUP';
  END IF;
END $$;

-- =========================================================
-- 2) ExternalRequest table (manual prod creation)
-- =========================================================
CREATE TABLE IF NOT EXISTS "enertrans_prod"."ExternalRequest" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "unitId" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "tasks" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "providerFileName" TEXT NOT NULL DEFAULT '',
  "providerFileUrl" TEXT NOT NULL DEFAULT '',
  "companyName" TEXT NOT NULL DEFAULT '',
  CONSTRAINT "ExternalRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ExternalRequest_code_key"
  ON "enertrans_prod"."ExternalRequest"("code");

DO $$
BEGIN
  ALTER TABLE "enertrans_prod"."ExternalRequest"
    ADD CONSTRAINT "ExternalRequest_unitId_fkey"
    FOREIGN KEY ("unitId")
    REFERENCES "enertrans_prod"."FleetUnit"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- =========================================================
-- 3) FleetMovement: remito delivery/receiver contact fields
-- =========================================================
ALTER TABLE "enertrans_prod"."FleetMovement"
  ADD COLUMN IF NOT EXISTS "deliveryContactName" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "deliveryContactDni" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "deliveryContactSector" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "deliveryContactRole" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "receiverContactName" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "receiverContactDni" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "receiverContactSector" TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "receiverContactRole" TEXT NOT NULL DEFAULT '';

-- =========================================================
-- 4) FleetMovement legacy unitId nullable (many-to-many migration compatibility)
-- =========================================================
ALTER TABLE "enertrans_prod"."FleetMovement"
  ALTER COLUMN "unitId" DROP NOT NULL;

-- =========================================================
-- 5) FleetMovementUnit pivot table for remitos multi-unit
-- =========================================================
CREATE TABLE IF NOT EXISTS "enertrans_prod"."FleetMovementUnit" (
  "movementId" TEXT NOT NULL,
  "unitId" TEXT NOT NULL,
  CONSTRAINT "FleetMovementUnit_pkey" PRIMARY KEY ("movementId", "unitId")
);

-- Support indexes
CREATE INDEX IF NOT EXISTS "FleetMovementUnit_movementId_idx"
  ON "enertrans_prod"."FleetMovementUnit" ("movementId");

CREATE INDEX IF NOT EXISTS "FleetMovementUnit_unitId_idx"
  ON "enertrans_prod"."FleetMovementUnit" ("unitId");

-- FleetMovement.id primary key (was missing in production drift)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'enertrans_prod'
      AND table_name = 'FleetMovement'
      AND constraint_type = 'PRIMARY KEY'
  ) THEN
    ALTER TABLE "enertrans_prod"."FleetMovement"
      ADD CONSTRAINT "FleetMovement_pkey" PRIMARY KEY ("id");
  END IF;
END $$;

-- FKs for pivot table (safe after FleetMovement PK exists)
DO $$
BEGIN
  ALTER TABLE "enertrans_prod"."FleetMovementUnit"
    ADD CONSTRAINT "FleetMovementUnit_movementId_fkey"
    FOREIGN KEY ("movementId")
    REFERENCES "enertrans_prod"."FleetMovement"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "enertrans_prod"."FleetMovementUnit"
    ADD CONSTRAINT "FleetMovementUnit_unitId_fkey"
    FOREIGN KEY ("unitId")
    REFERENCES "enertrans_prod"."FleetUnit"("id")
    ON DELETE RESTRICT
    ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMIT;

-- =========================================================
-- Post-run verification queries (read-only)
-- =========================================================
-- FleetMovement constraints
-- SELECT tc.constraint_type, kcu.column_name, tc.constraint_name
-- FROM information_schema.table_constraints tc
-- JOIN information_schema.key_column_usage kcu
--   ON tc.constraint_name = kcu.constraint_name
--  AND tc.table_schema = kcu.table_schema
-- WHERE tc.table_schema = 'enertrans_prod'
--   AND tc.table_name = 'FleetMovement'
-- ORDER BY tc.constraint_type, tc.constraint_name;

-- FleetMovementUnit constraints
-- SELECT tc.constraint_type, kcu.column_name, tc.constraint_name
-- FROM information_schema.table_constraints tc
-- JOIN information_schema.key_column_usage kcu
--   ON tc.constraint_name = kcu.constraint_name
--  AND tc.table_schema = kcu.table_schema
-- WHERE tc.table_schema = 'enertrans_prod'
--   AND tc.table_name = 'FleetMovementUnit'
-- ORDER BY tc.constraint_type, tc.constraint_name;

-- ExternalRequest exists
-- SELECT table_schema, table_name
-- FROM information_schema.tables
-- WHERE table_schema = 'enertrans_prod'
--   AND table_name = 'ExternalRequest';

-- FleetUnitType enum values
-- SELECT e.enumlabel
-- FROM pg_enum e
-- JOIN pg_type t ON t.oid = e.enumtypid
-- JOIN pg_namespace n ON n.oid = t.typnamespace
-- WHERE n.nspname = 'enertrans_prod'
--   AND t.typname = 'FleetUnitType'
-- ORDER BY e.enumsortorder;
