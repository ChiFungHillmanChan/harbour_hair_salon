-- AlterTable
ALTER TABLE "Service" ADD COLUMN "requiresConsultation" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Service" ADD COLUMN "isConsultation" BOOLEAN NOT NULL DEFAULT false;
