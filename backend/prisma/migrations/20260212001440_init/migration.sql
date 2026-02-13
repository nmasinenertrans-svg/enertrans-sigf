-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('DEV', 'GERENTE', 'COORDINADOR', 'AUDITOR', 'MECANICO');

-- CreateEnum
CREATE TYPE "FleetOperationalStatus" AS ENUM ('OPERATIONAL', 'MAINTENANCE', 'OUT_OF_SERVICE');

-- CreateEnum
CREATE TYPE "FleetUnitType" AS ENUM ('CHASSIS', 'CHASSIS_WITH_HYDROCRANE', 'TRACTOR', 'TRACTOR_WITH_HYDROCRANE', 'SEMI_TRAILER', 'AUTOMOBILE', 'VAN');

-- CreateEnum
CREATE TYPE "AuditResult" AS ENUM ('APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "WorkOrderStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'CLOSED');

-- CreateEnum
CREATE TYPE "VisualStatus" AS ENUM ('OVERDUE', 'OK', 'DUE_SOON');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "avatarUrl" TEXT NOT NULL DEFAULT '',
    "permissions" JSONB,
    "permissionOverrides" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FleetUnit" (
    "id" TEXT NOT NULL,
    "qrId" TEXT NOT NULL,
    "internalCode" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year" INTEGER NOT NULL DEFAULT 0,
    "clientName" TEXT NOT NULL DEFAULT '',
    "location" TEXT NOT NULL DEFAULT '',
    "ownerCompany" TEXT NOT NULL,
    "operationalStatus" "FleetOperationalStatus" NOT NULL,
    "unitType" "FleetUnitType" NOT NULL,
    "configurationNotes" TEXT NOT NULL,
    "chassisNumber" TEXT NOT NULL,
    "engineNumber" TEXT NOT NULL,
    "tareWeightKg" INTEGER NOT NULL,
    "maxLoadKg" INTEGER NOT NULL,
    "hasHydroCrane" BOOLEAN NOT NULL,
    "hydroCraneBrand" TEXT NOT NULL,
    "hydroCraneModel" TEXT NOT NULL,
    "hydroCraneSerialNumber" TEXT NOT NULL,
    "hasSemiTrailer" BOOLEAN NOT NULL,
    "semiTrailerUnitId" TEXT,
    "semiTrailerLicensePlate" TEXT NOT NULL,
    "semiTrailerBrand" TEXT NOT NULL,
    "semiTrailerModel" TEXT NOT NULL,
    "semiTrailerYear" INTEGER NOT NULL,
    "semiTrailerChassisNumber" TEXT NOT NULL,
    "tractorHistoryIds" JSONB NOT NULL,
    "currentKilometers" INTEGER NOT NULL DEFAULT 0,
    "currentEngineHours" INTEGER NOT NULL DEFAULT 0,
    "currentHydroHours" INTEGER NOT NULL DEFAULT 0,
    "lubricants" JSONB NOT NULL,
    "filters" JSONB NOT NULL,
    "documents" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FleetUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenancePlan" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "currentKilometers" INTEGER NOT NULL,
    "currentHours" INTEGER NOT NULL,
    "nextServiceByKilometers" INTEGER NOT NULL,
    "nextServiceByHours" INTEGER NOT NULL,
    "oils" JSONB NOT NULL,
    "filters" JSONB NOT NULL,
    "notes" TEXT NOT NULL,
    "status" "VisualStatus" NOT NULL,
    "serviceSchedule" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenancePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditRecord" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "auditKind" TEXT NOT NULL DEFAULT 'AUDIT',
    "unitId" TEXT NOT NULL,
    "auditorUserId" TEXT NOT NULL,
    "auditorName" TEXT NOT NULL,
    "workOrderId" TEXT,
    "performedAt" TIMESTAMP(3) NOT NULL,
    "result" "AuditResult" NOT NULL,
    "observations" TEXT NOT NULL,
    "photoUrls" JSONB NOT NULL,
    "checklist" JSONB NOT NULL,
    "unitKilometers" INTEGER NOT NULL DEFAULT 0,
    "engineHours" INTEGER NOT NULL DEFAULT 0,
    "hydroHours" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrder" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "pendingReaudit" BOOLEAN NOT NULL DEFAULT false,
    "unitId" TEXT NOT NULL,
    "status" "WorkOrderStatus" NOT NULL,
    "taskList" JSONB NOT NULL,
    "spareParts" JSONB NOT NULL,
    "laborDetail" TEXT NOT NULL,
    "linkedInventorySkuList" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepairRecord" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "supplierName" TEXT NOT NULL,
    "realCost" DOUBLE PRECISION NOT NULL,
    "invoicedToClient" DOUBLE PRECISION NOT NULL,
    "margin" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepairRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "stock" INTEGER NOT NULL,
    "movementHistory" JSONB NOT NULL,
    "linkedWorkOrderIds" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sequence" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "Sequence_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "FleetUnit_qrId_key" ON "FleetUnit"("qrId");

-- CreateIndex
CREATE UNIQUE INDEX "FleetUnit_internalCode_key" ON "FleetUnit"("internalCode");

-- CreateIndex
CREATE UNIQUE INDEX "AuditRecord_code_key" ON "AuditRecord"("code");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrder_code_key" ON "WorkOrder"("code");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_sku_key" ON "InventoryItem"("sku");

-- AddForeignKey
ALTER TABLE "FleetUnit" ADD CONSTRAINT "FleetUnit_semiTrailerUnitId_fkey" FOREIGN KEY ("semiTrailerUnitId") REFERENCES "FleetUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenancePlan" ADD CONSTRAINT "MaintenancePlan_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "FleetUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditRecord" ADD CONSTRAINT "AuditRecord_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "FleetUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditRecord" ADD CONSTRAINT "AuditRecord_auditorUserId_fkey" FOREIGN KEY ("auditorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "FleetUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairRecord" ADD CONSTRAINT "RepairRecord_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "FleetUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
