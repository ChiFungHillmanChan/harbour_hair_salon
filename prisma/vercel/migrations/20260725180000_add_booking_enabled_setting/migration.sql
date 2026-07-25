-- AlterTable
-- Defaults to false so the existing row keeps online booking CLOSED, exactly
-- matching the hardcoded BOOKING_MAINTENANCE = true it replaces.
ALTER TABLE "SiteSettings" ADD COLUMN     "bookingEnabled" BOOLEAN NOT NULL DEFAULT false;
