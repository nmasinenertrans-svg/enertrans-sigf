DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CrmDealKind') THEN
    CREATE TYPE "CrmDealKind" AS ENUM ('TENDER', 'CONTRACT');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CrmDealUnitStatus') THEN
    CREATE TYPE "CrmDealUnitStatus" AS ENUM ('EN_CONCURSO', 'ADJUDICADA', 'PERDIDA', 'LIBERADA');
  END IF;
END
$$;

ALTER TABLE "CrmDeal" ADD COLUMN IF NOT EXISTS "dealKind" "CrmDealKind" NOT NULL DEFAULT 'TENDER';
ALTER TABLE "CrmDeal" ADD COLUMN IF NOT EXISTS "referenceCode" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CrmDeal" ADD COLUMN IF NOT EXISTS "isHistorical" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "CrmDeal_dealKind_stage_idx" ON "CrmDeal"("dealKind", "stage");

CREATE TABLE IF NOT EXISTS "CrmDealUnit" (
  "id" TEXT NOT NULL,
  "dealId" TEXT NOT NULL,
  "unitId" TEXT NOT NULL,
  "status" "CrmDealUnitStatus" NOT NULL DEFAULT 'EN_CONCURSO',
  "notes" TEXT NOT NULL DEFAULT '',
  "createdByUserId" TEXT NOT NULL,
  "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "releasedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CrmDealUnit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CrmDealUnit_dealId_unitId_key" ON "CrmDealUnit"("dealId", "unitId");
CREATE INDEX IF NOT EXISTS "CrmDealUnit_dealId_status_idx" ON "CrmDealUnit"("dealId", "status");
CREATE INDEX IF NOT EXISTS "CrmDealUnit_unitId_status_idx" ON "CrmDealUnit"("unitId", "status");

DO $$
BEGIN
  ALTER TABLE "CrmDealUnit"
    ADD CONSTRAINT "CrmDealUnit_dealId_fkey"
    FOREIGN KEY ("dealId") REFERENCES "CrmDeal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "CrmDealUnit"
    ADD CONSTRAINT "CrmDealUnit_unitId_fkey"
    FOREIGN KEY ("unitId") REFERENCES "FleetUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "CrmDealUnit"
    ADD CONSTRAINT "CrmDealUnit_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;
