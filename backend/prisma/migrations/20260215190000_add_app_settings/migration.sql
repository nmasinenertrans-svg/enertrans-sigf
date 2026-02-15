CREATE TABLE IF NOT EXISTS "AppSettings" (
    "id" TEXT NOT NULL,
    "maintenanceEnabled" BOOLEAN NOT NULL DEFAULT false,
    "maintenanceMessage" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AppSettings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "AppSettings" ("id", "maintenanceEnabled", "maintenanceMessage", "createdAt", "updatedAt")
VALUES ('app', false, '', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
