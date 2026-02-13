-- CreateTable
CREATE TABLE "enertrans_sgi"."ExternalRequest" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "tasks" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExternalRequest_code_key" ON "enertrans_sgi"."ExternalRequest"("code");

-- AddForeignKey
ALTER TABLE "enertrans_sgi"."ExternalRequest" ADD CONSTRAINT "ExternalRequest_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "enertrans_sgi"."FleetUnit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
