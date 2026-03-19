ALTER TABLE "ExternalRequest" ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'ARS';
ALTER TABLE "ExternalRequest" ADD COLUMN IF NOT EXISTS "partsItems" JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "ExternalRequest" ADD COLUMN IF NOT EXISTS "partsTotal" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "ExternalRequest" ADD COLUMN IF NOT EXISTS "eligibilityStatus" TEXT NOT NULL DEFAULT 'PENDING_ATTACHMENT';
ALTER TABLE "ExternalRequest" ADD COLUMN IF NOT EXISTS "linkedRepairId" TEXT;

ALTER TABLE "RepairRecord" ADD COLUMN IF NOT EXISTS "linkedExternalRequestIds" JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "RepairRecord" ADD COLUMN IF NOT EXISTS "laborCost" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "RepairRecord" ADD COLUMN IF NOT EXISTS "partsCost" DOUBLE PRECISION NOT NULL DEFAULT 0;

UPDATE "RepairRecord"
SET "laborCost" = COALESCE("realCost", 0)
WHERE COALESCE("laborCost", 0) = 0 AND COALESCE("partsCost", 0) = 0;

CREATE INDEX IF NOT EXISTS "ExternalRequest_linkedRepairId_idx" ON "ExternalRequest"("linkedRepairId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ExternalRequest_linkedRepairId_fkey') THEN
    ALTER TABLE "ExternalRequest"
      ADD CONSTRAINT "ExternalRequest_linkedRepairId_fkey"
      FOREIGN KEY ("linkedRepairId") REFERENCES "RepairRecord"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END
$$;
