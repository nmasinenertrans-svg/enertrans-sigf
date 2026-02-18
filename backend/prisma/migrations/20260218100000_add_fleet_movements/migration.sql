-- CreateEnum
CREATE TYPE "FleetMovementType" AS ENUM ('ENTRY', 'RETURN');

-- CreateTable
CREATE TABLE "FleetMovement" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "movementType" "FleetMovementType" NOT NULL,
    "remitoNumber" TEXT NOT NULL DEFAULT '',
    "remitoDate" TIMESTAMP(3),
    "clientName" TEXT NOT NULL DEFAULT '',
    "workLocation" TEXT NOT NULL DEFAULT '',
    "equipmentDescription" TEXT NOT NULL DEFAULT '',
    "observations" TEXT NOT NULL DEFAULT '',
    "pdfFileName" TEXT NOT NULL DEFAULT '',
    "pdfFileUrl" TEXT NOT NULL DEFAULT '',
    "parsedPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

-- AddForeignKey
ALTER TABLE "FleetMovement" ADD CONSTRAINT "FleetMovement_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "FleetUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
