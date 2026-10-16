-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "consultationCreditFromId" TEXT,
ADD COLUMN     "consultationCreditPence" INTEGER;

-- CreateIndex
CREATE INDEX "Appointment_consultationCreditFromId_idx" ON "Appointment"("consultationCreditFromId");

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_consultationCreditFromId_fkey" FOREIGN KEY ("consultationCreditFromId") REFERENCES "Appointment"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

