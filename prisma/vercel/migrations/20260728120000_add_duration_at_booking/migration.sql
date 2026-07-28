-- AlterTable
-- Freeze the service duration at booking time (mirrors priceAtBooking) so a later
-- edit to a service's duration cannot retroactively resize existing appointments
-- and silently create overlaps. Nullable: legacy rows fall back to live duration.
ALTER TABLE "Appointment" ADD COLUMN     "durationAtBooking" INTEGER;
