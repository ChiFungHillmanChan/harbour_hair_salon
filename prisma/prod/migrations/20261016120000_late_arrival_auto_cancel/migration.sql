BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[Appointment] ADD [arrivedAt] DATETIME2,
[lateCancelledAt] DATETIME2;

-- AlterTable
ALTER TABLE [dbo].[SiteSettings] ADD [lateAutoCancelSince] DATETIME2;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

