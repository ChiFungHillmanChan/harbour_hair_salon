-- CreateTable
CREATE TABLE "GoogleCalendarEvent" (
    "appointmentId" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "syncedHash" TEXT,
    "syncedAt" DATETIME,
    "removed" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GoogleCalendarEvent_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GoogleCalendarSyncState" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "channelId" TEXT,
    "resourceId" TEXT,
    "channelExpiresAt" DATETIME,
    "lastPullAt" DATETIME,
    "lastPullSuccessAt" DATETIME,
    "lastPullError" TEXT,
    "busyHash" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "GoogleCalendarEvent_eventId_key" ON "GoogleCalendarEvent"("eventId");

