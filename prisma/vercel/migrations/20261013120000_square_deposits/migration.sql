-- AlterTable
ALTER TABLE "Service" ADD COLUMN     "depositOverridePence" INTEGER;

-- AlterTable
ALTER TABLE "SiteSettings" ADD COLUMN     "depositMinimumServicePence" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "depositPercent" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "depositsEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PaymentAttempt" (
    "id" TEXT NOT NULL,
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
    "delayedUntil" TIMESTAMP(3),
    "authorizedAt" TIMESTAMP(3),
    "capturedAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentRefund" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "squareRefundId" TEXT,
    "amountPence" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "reason" TEXT NOT NULL,
    "requestedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentRefund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SquareWebhookEvent" (
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "objectId" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "SquareWebhookEvent_pkey" PRIMARY KEY ("eventId")
);

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

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRefund" ADD CONSTRAINT "PaymentRefund_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "PaymentAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

