BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[GoogleCalendarSyncState] ADD [calendarId] NVARCHAR(1000);

-- AlterTable
ALTER TABLE [dbo].[SiteSettings] ADD [googleLeaveColorId] NVARCHAR(1000) NOT NULL CONSTRAINT [SiteSettings_googleLeaveColorId_df] DEFAULT '8',
[googleUnassignedColorId] NVARCHAR(1000) NOT NULL CONSTRAINT [SiteSettings_googleUnassignedColorId_df] DEFAULT '11';

-- AlterTable
ALTER TABLE [dbo].[Stylist] ADD [googleAliases] NVARCHAR(1000),
[googleColorId] NVARCHAR(1000);

-- CreateTable
CREATE TABLE [dbo].[GoogleDiaryEntry] (
    [id] NVARCHAR(1000) NOT NULL,
    [googleEventId] NVARCHAR(1000) NOT NULL,
    [kind] NVARCHAR(1000) NOT NULL,
    [stylistIdsJson] NVARCHAR(1000) NOT NULL CONSTRAINT [GoogleDiaryEntry_stylistIdsJson_df] DEFAULT '[]',
    [title] NVARCHAR(1000) NOT NULL,
    [colorId] NVARCHAR(1000),
    [start] DATETIME2 NOT NULL,
    [end] DATETIME2 NOT NULL,
    [allDay] BIT NOT NULL CONSTRAINT [GoogleDiaryEntry_allDay_df] DEFAULT 0,
    [htmlLink] NVARCHAR(1000),
    [lastSyncAt] DATETIME2 NOT NULL CONSTRAINT [GoogleDiaryEntry_lastSyncAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [GoogleDiaryEntry_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [GoogleDiaryEntry_googleEventId_key] UNIQUE NONCLUSTERED ([googleEventId])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [GoogleDiaryEntry_kind_start_idx] ON [dbo].[GoogleDiaryEntry]([kind], [start]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [GoogleDiaryEntry_end_idx] ON [dbo].[GoogleDiaryEntry]([end]);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
