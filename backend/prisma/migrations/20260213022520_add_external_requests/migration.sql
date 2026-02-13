-- AlterTable
ALTER TABLE "enertrans_sgi"."ExternalRequest" ADD COLUMN     "providerFileName" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "providerFileUrl" TEXT NOT NULL DEFAULT '';
