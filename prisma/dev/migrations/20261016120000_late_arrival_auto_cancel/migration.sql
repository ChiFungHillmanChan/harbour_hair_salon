-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN "arrivedAt" DATETIME;
ALTER TABLE "Appointment" ADD COLUMN "lateCancelledAt" DATETIME;

-- AlterTable
ALTER TABLE "SiteSettings" ADD COLUMN "lateAutoCancelSince" DATETIME;

