DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CrmDealStage') THEN
    CREATE TYPE "CrmDealStage" AS ENUM ('LEAD', 'CONTACTED', 'QUALIFICATION', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CrmActivityType') THEN
    CREATE TYPE "CrmActivityType" AS ENUM ('CALL', 'WHATSAPP', 'EMAIL', 'MEETING', 'TASK');
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CrmActivityStatus') THEN
    CREATE TYPE "CrmActivityStatus" AS ENUM ('PENDING', 'DONE');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS "CrmDeal" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "companyName" TEXT NOT NULL,
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
  "createdByUserId" TEXT NOT NULL,
  "wonAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CrmDeal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CrmActivity" (
  "id" TEXT NOT NULL,
  "dealId" TEXT NOT NULL,
  "type" "CrmActivityType" NOT NULL,
  "status" "CrmActivityStatus" NOT NULL DEFAULT 'PENDING',
  "summary" TEXT NOT NULL,
  "dueAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CrmActivity_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CrmDeal_stage_createdAt_idx" ON "CrmDeal"("stage", "createdAt");
CREATE INDEX IF NOT EXISTS "CrmDeal_assignedToUserId_stage_idx" ON "CrmDeal"("assignedToUserId", "stage");
CREATE INDEX IF NOT EXISTS "CrmDeal_companyName_idx" ON "CrmDeal"("companyName");
CREATE INDEX IF NOT EXISTS "CrmActivity_dealId_status_dueAt_idx" ON "CrmActivity"("dealId", "status", "dueAt");
CREATE INDEX IF NOT EXISTS "CrmActivity_createdByUserId_createdAt_idx" ON "CrmActivity"("createdByUserId", "createdAt");

DO $$
BEGIN
  ALTER TABLE "CrmDeal"
    ADD CONSTRAINT "CrmDeal_assignedToUserId_fkey"
    FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "CrmDeal"
    ADD CONSTRAINT "CrmDeal_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "CrmActivity"
    ADD CONSTRAINT "CrmActivity_dealId_fkey"
    FOREIGN KEY ("dealId") REFERENCES "CrmDeal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

DO $$
BEGIN
  ALTER TABLE "CrmActivity"
    ADD CONSTRAINT "CrmActivity_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;
