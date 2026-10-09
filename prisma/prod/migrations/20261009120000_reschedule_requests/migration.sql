BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[Appointment] ADD [rescheduleRequestedAt] DATETIME2,
[rescheduleRequestedDate] DATETIME2;

-- CreateIndex
CREATE NONCLUSTERED INDEX [Appointment_rescheduleRequestedDate_idx] ON [dbo].[Appointment]([rescheduleRequestedDate]);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
