-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3);

-- Accounts that have already proved their address need not do it again:
-- administrators (created by the salon) and anyone who has redeemed a password
-- reset link. Google sign-ins are recognised at runtime by their linked account.
UPDATE "User" SET "emailVerifiedAt" = CURRENT_TIMESTAMP
WHERE "role" = 'ADMIN'
   OR EXISTS (SELECT 1 FROM "PasswordResetToken" t WHERE t."userId" = "User"."id" AND t."usedAt" IS NOT NULL);
