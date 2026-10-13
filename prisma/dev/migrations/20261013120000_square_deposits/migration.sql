-- AlterTable
ALTER TABLE "Service" ADD COLUMN "depositOverridePence" INTEGER;

-- CreateTable
CREATE TABLE "PaymentAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "attemptKey" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "appointmentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'INITIATED',
    "environment" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "amountPence" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "quoteAmountPence" INTEGER NOT NULL,
    "policyJson" TEXT NOT NULL,
    "requestJson" TEXT NOT NULL,
    "squarePaymentId" TEXT,
    "delayedUntil" DATETIME,
    "authorizedAt" DATETIME,
    "capturedAt" DATETIME,
    "voidedAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PaymentAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PaymentAttempt_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PaymentRefund" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "attemptId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "squareRefundId" TEXT,
    "amountPence" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "reason" TEXT NOT NULL,
    "requestedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PaymentRefund_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "PaymentAttempt" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SquareWebhookEvent" (
    "eventId" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "objectId" TEXT,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" DATETIME
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SiteSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "phone" TEXT NOT NULL DEFAULT '07831 830898',
    "twitterHandle" TEXT NOT NULL DEFAULT '',
    "gscVerification" TEXT NOT NULL DEFAULT '',
    "googleBusinessUrl" TEXT NOT NULL DEFAULT 'https://www.google.com/maps/place/Harbour+Hair/data=!4m2!3m1!1s0x0:0xad74be12e1f34d1a?sa=X&ved=1t:2428&ictx=111',
    "facebookUrl" TEXT NOT NULL DEFAULT '',
    "instagramUrl" TEXT NOT NULL DEFAULT 'https://www.instagram.com/harbourhair_leeds/',
    "treatwellUrl" TEXT NOT NULL DEFAULT 'https://www.treatwell.co.uk/place/harbour-hair-hk-hair-stylist/',
    "freshaUrl" TEXT NOT NULL DEFAULT '',
    "booksyUrl" TEXT NOT NULL DEFAULT '',
    "heroEyebrow" TEXT NOT NULL DEFAULT 'Leeds City Centre',
    "heroTitleLine1" TEXT NOT NULL DEFAULT 'Expert Hair',
    "heroTitleLine2" TEXT NOT NULL DEFAULT 'Styling',
    "heroSubtitle" TEXT NOT NULL DEFAULT 'Tailored cuts, colours and grooming by Hong Kong trained stylists. Precision and artistry in every appointment.',
    "bookingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "salonNotificationLocale" TEXT NOT NULL DEFAULT 'zh-HK',
    "depositsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "depositPercent" INTEGER NOT NULL DEFAULT 0,
    "depositMinimumServicePence" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_SiteSettings" ("bookingEnabled", "booksyUrl", "facebookUrl", "freshaUrl", "googleBusinessUrl", "gscVerification", "heroEyebrow", "heroSubtitle", "heroTitleLine1", "heroTitleLine2", "id", "instagramUrl", "phone", "salonNotificationLocale", "treatwellUrl", "twitterHandle", "updatedAt") SELECT "bookingEnabled", "booksyUrl", "facebookUrl", "freshaUrl", "googleBusinessUrl", "gscVerification", "heroEyebrow", "heroSubtitle", "heroTitleLine1", "heroTitleLine2", "id", "instagramUrl", "phone", "salonNotificationLocale", "treatwellUrl", "twitterHandle", "updatedAt" FROM "SiteSettings";
DROP TABLE "SiteSettings";
ALTER TABLE "new_SiteSettings" RENAME TO "SiteSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_idempotencyKey_key" ON "PaymentAttempt"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_appointmentId_key" ON "PaymentAttempt"("appointmentId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_squarePaymentId_key" ON "PaymentAttempt"("squarePaymentId");

-- CreateIndex
CREATE INDEX "PaymentAttempt_status_createdAt_idx" ON "PaymentAttempt"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_userId_attemptKey_key" ON "PaymentAttempt"("userId", "attemptKey");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRefund_idempotencyKey_key" ON "PaymentRefund"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRefund_squareRefundId_key" ON "PaymentRefund"("squareRefundId");

-- CreateIndex
CREATE INDEX "PaymentRefund_status_createdAt_idx" ON "PaymentRefund"("status", "createdAt");

