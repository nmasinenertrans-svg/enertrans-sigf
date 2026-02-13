/*
  Warnings:

  - Added the required column `companyName` to the `ExternalRequest` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "enertrans_sgi"."ExternalRequest" ADD COLUMN     "companyName" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "enertrans_sgi"."RepairRecord" ADD COLUMN     "externalRequestId" TEXT,
ADD COLUMN     "invoiceFileBase64" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "invoiceFileName" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "invoiceFileUrl" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "sourceType" TEXT NOT NULL DEFAULT 'WORK_ORDER',
ALTER COLUMN "workOrderId" DROP NOT NULL;
