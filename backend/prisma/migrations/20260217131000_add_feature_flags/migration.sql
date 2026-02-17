ALTER TABLE "AppSettings"
ADD COLUMN "featureFlags" JSONB NOT NULL DEFAULT '{}'::jsonb;
