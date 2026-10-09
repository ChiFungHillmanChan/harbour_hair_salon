-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "rescheduleRequestedAt" TIMESTAMP(3),
ADD COLUMN     "rescheduleRequestedDate" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Appointment_rescheduleRequestedDate_idx" ON "Appointment"("rescheduleRequestedDate");
