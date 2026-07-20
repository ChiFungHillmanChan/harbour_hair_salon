BEGIN TRY

BEGIN TRAN;

ALTER TABLE [dbo].[Stylist] ADD [treatwellExternalId] NVARCHAR(1000);
ALTER TABLE [dbo].[Service] ADD [treatwellExternalId] NVARCHAR(1000);
ALTER TABLE [dbo].[Appointment] ADD
  [treatwellBookingId] NVARCHAR(1000),
  [treatwellSyncStatus] NVARCHAR(1000) NOT NULL CONSTRAINT [Appointment_treatwellSyncStatus_df] DEFAULT 'NOT_REQUIRED',
  [treatwellSyncError] NVARCHAR(1000),
  [treatwellSyncedAt] DATETIME2;

CREATE NONCLUSTERED INDEX [Appointment_treatwellSyncStatus_updatedAt_idx]
ON [dbo].[Appointment]([treatwellSyncStatus], [updatedAt]);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
