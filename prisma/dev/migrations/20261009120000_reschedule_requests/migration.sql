-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN "rescheduleRequestedAt" DATETIME;
ALTER TABLE "Appointment" ADD COLUMN "rescheduleRequestedDate" DATETIME;

-- CreateIndex
CREATE INDEX "Appointment_rescheduleRequestedDate_idx" ON "Appointment"("rescheduleRequestedDate");
