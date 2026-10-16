BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[Appointment] ADD [consultationCreditFromId] NVARCHAR(1000),
[consultationCreditPence] INT;

-- CreateIndex
CREATE NONCLUSTERED INDEX [Appointment_consultationCreditFromId_idx] ON [dbo].[Appointment]([consultationCreditFromId]);

-- AddForeignKey
ALTER TABLE [dbo].[Appointment] ADD CONSTRAINT [Appointment_consultationCreditFromId_fkey] FOREIGN KEY ([consultationCreditFromId]) REFERENCES [dbo].[Appointment]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

