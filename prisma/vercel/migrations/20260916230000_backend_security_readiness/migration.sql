-- Additive security/session/audit tables and indexes. Existing customer rows remain intact.
BEGIN;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "mfaEnabledAt" TIMESTAMP(3),
ADD COLUMN     "mfaLastUsedStep" INTEGER,
ADD COLUMN     "mfaPendingExpiresAt" TIMESTAMP(3),
ADD COLUMN     "mfaPendingSecretEncrypted" TEXT,
ADD COLUMN     "mfaRecoveryCodesJson" TEXT NOT NULL DEFAULT '[]',
ADD COLUMN     "mfaSecretEncrypted" TEXT;

-- CreateTable
CREATE TABLE "KioskSession" (
    "id" TEXT NOT NULL,
    "deviceName" TEXT NOT NULL DEFAULT 'Salon kiosk',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdByAdminId" TEXT,

    CONSTRAINT "KioskSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "metadataJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KioskSession_revokedAt_expiresAt_idx" ON "KioskSession"("revokedAt", "expiresAt");

-- CreateIndex
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_actorUserId_createdAt_idx" ON "AuditEvent"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_targetType_targetId_idx" ON "AuditEvent"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "Appointment_userId_date_id_idx" ON "Appointment"("userId", "date", "id");

-- CreateIndex
CREATE INDEX "Appointment_status_date_id_idx" ON "Appointment"("status", "date", "id");

-- CreateIndex
CREATE INDEX "ExternalBusyBlock_end_idx" ON "ExternalBusyBlock"("end");

-- CreateIndex
CREATE INDEX "NotificationDelivery_appointmentId_kind_idx" ON "NotificationDelivery"("appointmentId", "kind");

-- CreateIndex
CREATE INDEX "NotificationDelivery_status_lockedAt_idx" ON "NotificationDelivery"("status", "lockedAt");

-- CreateIndex
CREATE INDEX "NotificationDelivery_status_createdAt_idx" ON "NotificationDelivery"("status", "createdAt");

COMMIT;
