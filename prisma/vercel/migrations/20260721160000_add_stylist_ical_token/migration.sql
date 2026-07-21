-- Secret token for each stylist's outbound busy-feed URL
-- (GET /api/ical/[stylistId]?token=...) that Treatwell Connect subscribes to.
ALTER TABLE "Stylist" ADD COLUMN "icalToken" TEXT;

CREATE UNIQUE INDEX "Stylist_icalToken_key" ON "Stylist"("icalToken");
