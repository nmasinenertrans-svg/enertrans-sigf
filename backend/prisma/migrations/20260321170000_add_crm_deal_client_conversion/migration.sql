ALTER TABLE "CrmDeal" ADD COLUMN IF NOT EXISTS "convertedClientId" TEXT;

CREATE INDEX IF NOT EXISTS "CrmDeal_convertedClientId_idx" ON "CrmDeal"("convertedClientId");

DO $$
BEGIN
  ALTER TABLE "CrmDeal"
    ADD CONSTRAINT "CrmDeal_convertedClientId_fkey"
    FOREIGN KEY ("convertedClientId") REFERENCES "ClientAccount"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;
