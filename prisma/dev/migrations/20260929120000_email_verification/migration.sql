-- AlterTable
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" DATETIME;

-- Same backfill as prisma/vercel (see there).
UPDATE "User" SET "emailVerifiedAt" = CURRENT_TIMESTAMP
WHERE "role" = 'ADMIN'
   OR EXISTS (SELECT 1 FROM "PasswordResetToken" t WHERE t."userId" = "User"."id" AND t."usedAt" IS NOT NULL);
