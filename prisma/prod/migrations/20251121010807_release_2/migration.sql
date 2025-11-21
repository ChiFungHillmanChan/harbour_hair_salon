BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[Appointment] ADD [discountCodeId] NVARCHAR(1000);

-- CreateTable
CREATE TABLE [dbo].[DiscountCode] (
    [id] NVARCHAR(1000) NOT NULL,
    [code] NVARCHAR(1000) NOT NULL,
    [type] NVARCHAR(1000) NOT NULL,
    [value] DECIMAL(32,16) NOT NULL,
    [maxUses] INT,
    [usedCount] INT NOT NULL CONSTRAINT [DiscountCode_usedCount_df] DEFAULT 0,
    [expiresAt] DATETIME2,
    [isActive] BIT NOT NULL CONSTRAINT [DiscountCode_isActive_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [DiscountCode_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [DiscountCode_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [DiscountCode_code_key] UNIQUE NONCLUSTERED ([code])
);

-- CreateTable
CREATE TABLE [dbo].[Offer] (
    [id] NVARCHAR(1000) NOT NULL,
    [title] NVARCHAR(1000) NOT NULL,
    [description] NVARCHAR(1000),
    [discountType] NVARCHAR(1000) NOT NULL,
    [discountValue] DECIMAL(32,16) NOT NULL,
    [isActive] BIT NOT NULL CONSTRAINT [Offer_isActive_df] DEFAULT 1,
    [isGlobal] BIT NOT NULL CONSTRAINT [Offer_isGlobal_df] DEFAULT 0,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Offer_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Offer_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- AddForeignKey
ALTER TABLE [dbo].[Appointment] ADD CONSTRAINT [Appointment_discountCodeId_fkey] FOREIGN KEY ([discountCodeId]) REFERENCES [dbo].[DiscountCode]([id]) ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
