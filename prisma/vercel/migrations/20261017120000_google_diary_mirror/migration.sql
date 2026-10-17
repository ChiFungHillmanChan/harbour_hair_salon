-- AlterTable
ALTER TABLE "GoogleCalendarSyncState" ADD COLUMN     "calendarId" TEXT;

-- AlterTable
ALTER TABLE "SiteSettings" ADD COLUMN     "googleLeaveColorId" TEXT NOT NULL DEFAULT '8',
ADD COLUMN     "googleUnassignedColorId" TEXT NOT NULL DEFAULT '11';

-- AlterTable
ALTER TABLE "Stylist" ADD COLUMN     "googleAliases" TEXT,
ADD COLUMN     "googleColorId" TEXT;

-- CreateTable
CREATE TABLE "GoogleDiaryEntry" (
    "id" TEXT NOT NULL,
    "googleEventId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "stylistIdsJson" TEXT NOT NULL DEFAULT '[]',
    "title" TEXT NOT NULL,
    "colorId" TEXT,
    "start" TIMESTAMP(3) NOT NULL,
    "end" TIMESTAMP(3) NOT NULL,
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "htmlLink" TEXT,
    "lastSyncAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoogleDiaryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GoogleDiaryEntry_googleEventId_key" ON "GoogleDiaryEntry"("googleEventId");

-- CreateIndex
CREATE INDEX "GoogleDiaryEntry_kind_start_idx" ON "GoogleDiaryEntry"("kind", "start");

-- CreateIndex
CREATE INDEX "GoogleDiaryEntry_end_idx" ON "GoogleDiaryEntry"("end");
