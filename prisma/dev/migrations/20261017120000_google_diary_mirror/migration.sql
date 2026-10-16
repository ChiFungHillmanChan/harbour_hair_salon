-- AlterTable
ALTER TABLE "GoogleCalendarSyncState" ADD COLUMN "calendarId" TEXT;

-- AlterTable
ALTER TABLE "SiteSettings" ADD COLUMN "googleLeaveColorId" TEXT NOT NULL DEFAULT '8';
ALTER TABLE "SiteSettings" ADD COLUMN "googleUnassignedColorId" TEXT NOT NULL DEFAULT '11';

-- AlterTable
ALTER TABLE "Stylist" ADD COLUMN "googleAliases" TEXT;
ALTER TABLE "Stylist" ADD COLUMN "googleColorId" TEXT;

-- CreateTable
CREATE TABLE "GoogleDiaryEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "googleEventId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "stylistIdsJson" TEXT NOT NULL DEFAULT '[]',
    "title" TEXT NOT NULL,
    "colorId" TEXT,
    "start" DATETIME NOT NULL,
    "end" DATETIME NOT NULL,
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "htmlLink" TEXT,
    "lastSyncAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "GoogleDiaryEntry_googleEventId_key" ON "GoogleDiaryEntry"("googleEventId");

-- CreateIndex
CREATE INDEX "GoogleDiaryEntry_kind_start_idx" ON "GoogleDiaryEntry"("kind", "start");

-- CreateIndex
CREATE INDEX "GoogleDiaryEntry_end_idx" ON "GoogleDiaryEntry"("end");
