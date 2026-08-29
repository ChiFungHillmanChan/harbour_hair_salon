-- The Opening Hours editor upserts one row per (stylistId, dayOfWeek), which
-- needs a unique key to target. Nothing enforced that before, so collapse any
-- duplicates that already exist before creating the index — otherwise this
-- migration fails on a database that has them.
--
-- `a.id < b.id` is an arbitrary but deterministic tiebreak; the surviving row's
-- hours are then corrected by the salon in Admin -> Opening Hours.
DELETE FROM "Availability" a
USING "Availability" b
WHERE a."stylistId" = b."stylistId"
  AND a."dayOfWeek" = b."dayOfWeek"
  AND a."id" < b."id";

-- DropIndex: @@unique supersedes it; keeping both indexes the same columns twice.
DROP INDEX IF EXISTS "Availability_stylistId_dayOfWeek_idx";

-- CreateIndex
CREATE UNIQUE INDEX "Availability_stylistId_dayOfWeek_key" ON "Availability"("stylistId", "dayOfWeek");
