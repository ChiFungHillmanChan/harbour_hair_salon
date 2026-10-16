-- CreateTable
CREATE TABLE "GoogleCalendarEvent" (
    "appointmentId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "syncedHash" TEXT,
    "syncedAt" TIMESTAMP(3),
    "removed" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoogleCalendarEvent_pkey" PRIMARY KEY ("appointmentId")
);

-- CreateTable
CREATE TABLE "GoogleCalendarSyncState" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "channelId" TEXT,
    "resourceId" TEXT,
    "channelExpiresAt" TIMESTAMP(3),
    "lastPullAt" TIMESTAMP(3),
    "lastPullSuccessAt" TIMESTAMP(3),
    "lastPullError" TEXT,
    "busyHash" TEXT,

    CONSTRAINT "GoogleCalendarSyncState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GoogleCalendarEvent_eventId_key" ON "GoogleCalendarEvent"("eventId");

-- AddForeignKey
ALTER TABLE "GoogleCalendarEvent" ADD CONSTRAINT "GoogleCalendarEvent_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

