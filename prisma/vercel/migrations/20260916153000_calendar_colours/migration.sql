-- Nullable palette keys preserve existing service/stylist colours by default.
ALTER TABLE "Stylist" ADD COLUMN "calendarColor" TEXT;
ALTER TABLE "Service" ADD COLUMN "calendarColor" TEXT;
