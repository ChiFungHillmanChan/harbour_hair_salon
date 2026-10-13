-- Square deposits (docs/superpowers/specs/2026-10-13-square-deposits-design.md).
-- Generated with `prisma migrate diff` from the previous datamodel; the nullable
-- uniques (appointmentId, squarePaymentId, userId + attemptKey, squareRefundId)
-- were then moved to filtered indexes, because SQL Server otherwise allows only
-- one NULL. Prisma 6 cannot express these filters, so preserve them in
-- subsequent diffs. Not executed against SQL Server in this change.
BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[Service] ADD [depositOverridePence] INT;

-- AlterTable
ALTER TABLE [dbo].[SiteSettings] ADD [depositMinimumServicePence] INT NOT NULL CONSTRAINT [SiteSettings_depositMinimumServicePence_df] DEFAULT 0,
[depositPercent] INT NOT NULL CONSTRAINT [SiteSettings_depositPercent_df] DEFAULT 0,
[depositsEnabled] BIT NOT NULL CONSTRAINT [SiteSettings_depositsEnabled_df] DEFAULT 0;

-- CreateTable
CREATE TABLE [dbo].[PaymentAttempt] (
    [id] NVARCHAR(1000) NOT NULL,
    [userId] NVARCHAR(1000),
    [attemptKey] NVARCHAR(64) NOT NULL,
    [idempotencyKey] NVARCHAR(64) NOT NULL,
    [appointmentId] NVARCHAR(1000),
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [PaymentAttempt_status_df] DEFAULT 'INITIATED',
    [environment] NVARCHAR(1000) NOT NULL,
    [locationId] NVARCHAR(1000) NOT NULL,
    [amountPence] INT NOT NULL,
    [currency] NVARCHAR(1000) NOT NULL CONSTRAINT [PaymentAttempt_currency_df] DEFAULT 'GBP',
    [quoteAmountPence] INT NOT NULL,
    [policyJson] NVARCHAR(max) NOT NULL,
    [requestJson] NVARCHAR(max) NOT NULL,
    [squarePaymentId] NVARCHAR(255),
    [delayedUntil] DATETIME2,
    [authorizedAt] DATETIME2,
    [capturedAt] DATETIME2,
    [voidedAt] DATETIME2,
    [lastError] NVARCHAR(max),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PaymentAttempt_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [PaymentAttempt_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [PaymentAttempt_idempotencyKey_key] UNIQUE NONCLUSTERED ([idempotencyKey])
);

-- CreateTable
CREATE TABLE [dbo].[PaymentRefund] (
    [id] NVARCHAR(1000) NOT NULL,
    [attemptId] NVARCHAR(1000) NOT NULL,
    [idempotencyKey] NVARCHAR(64) NOT NULL,
    [squareRefundId] NVARCHAR(255),
    [amountPence] INT NOT NULL,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [PaymentRefund_status_df] DEFAULT 'REQUESTED',
    [reason] NVARCHAR(1000) NOT NULL,
    [requestedById] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PaymentRefund_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [PaymentRefund_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [PaymentRefund_idempotencyKey_key] UNIQUE NONCLUSTERED ([idempotencyKey])
);

-- CreateTable
CREATE TABLE [dbo].[SquareWebhookEvent] (
    [eventId] NVARCHAR(255) NOT NULL,
    [type] NVARCHAR(1000) NOT NULL,
    [objectId] NVARCHAR(1000),
    [receivedAt] DATETIME2 NOT NULL CONSTRAINT [SquareWebhookEvent_receivedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [processedAt] DATETIME2,
    CONSTRAINT [SquareWebhookEvent_pkey] PRIMARY KEY CLUSTERED ([eventId])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PaymentAttempt_status_createdAt_idx] ON [dbo].[PaymentAttempt]([status], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PaymentRefund_status_createdAt_idx] ON [dbo].[PaymentRefund]([status], [createdAt]);

-- SQL Server treats NULL as a unique value; keep these unique among non-NULL
-- values only, as on PostgreSQL and SQLite (unlinked attempts, attempts not yet
-- authorized, attempts of erased users, refunds Square has not answered).
CREATE UNIQUE NONCLUSTERED INDEX [PaymentAttempt_appointmentId_key] ON [dbo].[PaymentAttempt]([appointmentId]) WHERE [appointmentId] IS NOT NULL;

CREATE UNIQUE NONCLUSTERED INDEX [PaymentAttempt_squarePaymentId_key] ON [dbo].[PaymentAttempt]([squarePaymentId]) WHERE [squarePaymentId] IS NOT NULL;

CREATE UNIQUE NONCLUSTERED INDEX [PaymentAttempt_userId_attemptKey_key] ON [dbo].[PaymentAttempt]([userId], [attemptKey]) WHERE [userId] IS NOT NULL;

CREATE UNIQUE NONCLUSTERED INDEX [PaymentRefund_squareRefundId_key] ON [dbo].[PaymentRefund]([squareRefundId]) WHERE [squareRefundId] IS NOT NULL;

-- AddForeignKey
ALTER TABLE [dbo].[PaymentAttempt] ADD CONSTRAINT [PaymentAttempt_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PaymentAttempt] ADD CONSTRAINT [PaymentAttempt_appointmentId_fkey] FOREIGN KEY ([appointmentId]) REFERENCES [dbo].[Appointment]([id]) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[PaymentRefund] ADD CONSTRAINT [PaymentRefund_attemptId_fkey] FOREIGN KEY ([attemptId]) REFERENCES [dbo].[PaymentAttempt]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
