BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[User] ADD [preferredLocale] NVARCHAR(1000);

-- AlterTable
ALTER TABLE [dbo].[Service] ADD [durationConfirmed] BIT NOT NULL CONSTRAINT [Service_durationConfirmed_df] DEFAULT 1,
[hairLength] NVARCHAR(1000),
[isBookable] BIT NOT NULL CONSTRAINT [Service_isBookable_df] DEFAULT 1,
[isPublic] BIT NOT NULL CONSTRAINT [Service_isPublic_df] DEFAULT 1,
[offeringId] NVARCHAR(1000),
[priceNature] NVARCHAR(1000) NOT NULL CONSTRAINT [Service_priceNature_df] DEFAULT 'LISTED',
[priceNote] NVARCHAR(max),
[priceSource] NVARCHAR(1000),
[priceType] NVARCHAR(1000) NOT NULL CONSTRAINT [Service_priceType_df] DEFAULT 'STANDARD',
[priceVerifiedAt] DATETIME2,
[priceVersion] INT NOT NULL CONSTRAINT [Service_priceVersion_df] DEFAULT 1,
[surchargeAmount] DECIMAL(32,16),
[surchargeBaseServiceId] NVARCHAR(1000),
[vatDisplay] NVARCHAR(1000) NOT NULL CONSTRAINT [Service_vatDisplay_df] DEFAULT 'UNSPECIFIED';

-- AlterTable
ALTER TABLE [dbo].[Appointment] ADD [notificationLocale] NVARCHAR(1000),
[quoteJson] NVARCHAR(max);

-- AlterTable
ALTER TABLE [dbo].[SiteSettings] ADD [salonNotificationLocale] NVARCHAR(1000) NOT NULL CONSTRAINT [SiteSettings_salonNotificationLocale_df] DEFAULT 'zh-HK';

-- CreateTable
CREATE TABLE [dbo].[ServiceOffering] (
    [id] NVARCHAR(1000) NOT NULL,
    [key] NVARCHAR(1000) NOT NULL,
    [category] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [description] NVARCHAR(max),
    [displayOrder] INT NOT NULL CONSTRAINT [ServiceOffering_displayOrder_df] DEFAULT 0,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ServiceOffering_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [ServiceOffering_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [ServiceOffering_key_key] UNIQUE NONCLUSTERED ([key])
);

-- CreateTable
CREATE TABLE [dbo].[ContentTranslation] (
    [id] NVARCHAR(1000) NOT NULL,
    [entityType] NVARCHAR(1000) NOT NULL,
    [entityId] NVARCHAR(1000) NOT NULL,
    [locale] NVARCHAR(1000) NOT NULL,
    [fieldsJson] NVARCHAR(max) NOT NULL,
    [revision] INT NOT NULL,
    [publishedAt] DATETIME2 NOT NULL CONSTRAINT [ContentTranslation_publishedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [publishedByAdminId] NVARCHAR(1000),
    CONSTRAINT [ContentTranslation_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [ContentTranslation_entityType_entityId_locale_key] UNIQUE NONCLUSTERED ([entityType],[entityId],[locale])
);

-- CreateTable
CREATE TABLE [dbo].[ContentDraft] (
    [id] NVARCHAR(1000) NOT NULL,
    [entityType] NVARCHAR(1000) NOT NULL,
    [entityId] NVARCHAR(1000) NOT NULL,
    [baseRevision] INT NOT NULL CONSTRAINT [ContentDraft_baseRevision_df] DEFAULT 0,
    [fieldsJson] NVARCHAR(max) NOT NULL,
    [reviewJson] NVARCHAR(max) NOT NULL CONSTRAINT [ContentDraft_reviewJson_df] DEFAULT '{}',
    [sharedJson] NVARCHAR(max) NOT NULL CONSTRAINT [ContentDraft_sharedJson_df] DEFAULT '{}',
    [updatedByAdminId] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ContentDraft_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [ContentDraft_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [ContentDraft_entityType_entityId_key] UNIQUE NONCLUSTERED ([entityType],[entityId])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ContentTranslation_entityType_locale_idx] ON [dbo].[ContentTranslation]([entityType], [locale]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Service_offeringId_idx] ON [dbo].[Service]([offeringId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Service_isPublic_category_idx] ON [dbo].[Service]([isPublic], [category]);

-- AddForeignKey
ALTER TABLE [dbo].[Service] ADD CONSTRAINT [Service_offeringId_fkey] FOREIGN KEY ([offeringId]) REFERENCES [dbo].[ServiceOffering]([id]) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[Service] ADD CONSTRAINT [Service_surchargeBaseServiceId_fkey] FOREIGN KEY ([surchargeBaseServiceId]) REFERENCES [dbo].[Service]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

