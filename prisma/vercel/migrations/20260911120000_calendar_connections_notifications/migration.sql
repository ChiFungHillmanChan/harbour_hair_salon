-- DropIndex
DROP INDEX "ExternalBusyBlock_source_externalUid_key";

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "notificationVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "CalendarConnection" (
    "id" TEXT NOT NULL,
    "stylistId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "receivesBookings" BOOLEAN NOT NULL DEFAULT false,
    "inboundUrl" TEXT,
    "inboundEnabled" BOOLEAN NOT NULL DEFAULT false,
    "outboundConfirmedAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lockedUntil" TIMESTAMP(3),
    "lockToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationDelivery" (
    "id" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "appointmentId" TEXT,
    "payloadJson" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "firstAttemptAt" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockToken" TEXT,
    "sentAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackgroundJobState" (
    "name" TEXT NOT NULL,
    "lastStartedAt" TIMESTAMP(3),
    "lastSucceededAt" TIMESTAMP(3),
    "lastFailedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastResultJson" TEXT,
    "lockToken" TEXT,
    "lockedUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackgroundJobState_pkey" PRIMARY KEY ("name")
);

-- CreateIndex
CREATE INDEX "CalendarConnection_inboundEnabled_idx" ON "CalendarConnection"("inboundEnabled");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarConnection_stylistId_provider_key" ON "CalendarConnection"("stylistId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationDelivery_eventKey_key" ON "NotificationDelivery"("eventKey");

-- CreateIndex
CREATE INDEX "NotificationDelivery_status_nextAttemptAt_idx" ON "NotificationDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalBusyBlock_source_stylistId_externalUid_key" ON "ExternalBusyBlock"("source", "stylistId", "externalUid");

-- AddForeignKey
ALTER TABLE "CalendarConnection" ADD CONSTRAINT "CalendarConnection_stylistId_fkey" FOREIGN KEY ("stylistId") REFERENCES "Stylist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Preserve existing feed secrets. Marketing links seed initial sales activity
-- only during migration; subsequent link edits never silently change it.
-- A generated outbound token does not prove the provider subscribed to it.
INSERT INTO "CalendarConnection" ("id", "stylistId", "provider", "receivesBookings", "inboundUrl", "inboundEnabled", "createdAt", "updatedAt")
SELECT 'calendar_tw_' || s."id", s."id", 'TREATWELL',
       EXISTS (SELECT 1 FROM "SiteSettings" WHERE trim("treatwellUrl") <> ''),
       NULLIF(trim(s."treatwellIcalUrl"), ''),
       NULLIF(trim(s."treatwellIcalUrl"), '') IS NOT NULL,
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Stylist" s;
INSERT INTO "CalendarConnection" ("id", "stylistId", "provider", "receivesBookings", "createdAt", "updatedAt")
SELECT 'calendar_fr_' || s."id", s."id", 'FRESHA',
       EXISTS (SELECT 1 FROM "SiteSettings" WHERE trim("freshaUrl") <> ''),
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Stylist" s;
