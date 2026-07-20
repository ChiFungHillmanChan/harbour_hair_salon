-- Add Treatwell API mapping and outbound-sync state without changing the
-- existing iCal inbound integration.
ALTER TABLE "Stylist" ADD COLUMN "treatwellExternalId" TEXT;
ALTER TABLE "Service" ADD COLUMN "treatwellExternalId" TEXT;
ALTER TABLE "Appointment" ADD COLUMN "treatwellBookingId" TEXT;
ALTER TABLE "Appointment" ADD COLUMN "treatwellSyncStatus" TEXT NOT NULL DEFAULT 'NOT_REQUIRED';
ALTER TABLE "Appointment" ADD COLUMN "treatwellSyncError" TEXT;
ALTER TABLE "Appointment" ADD COLUMN "treatwellSyncedAt" DATETIME;

CREATE INDEX "Appointment_treatwellSyncStatus_updatedAt_idx"
ON "Appointment"("treatwellSyncStatus", "updatedAt");
