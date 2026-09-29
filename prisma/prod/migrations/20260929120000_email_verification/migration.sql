BEGIN TRY

BEGIN TRAN;

-- AlterTable
ALTER TABLE [dbo].[User] ADD [emailVerifiedAt] DATETIME2;

-- Same backfill as prisma/vercel (see there). Dynamic SQL: SQL Server compiles
-- the batch before the ALTER runs, so a direct reference to the new column fails.
EXEC('UPDATE [dbo].[User] SET [emailVerifiedAt] = CURRENT_TIMESTAMP
WHERE [role] = ''ADMIN''
   OR EXISTS (SELECT 1 FROM [dbo].[PasswordResetToken] t WHERE t.[userId] = [dbo].[User].[id] AND t.[usedAt] IS NOT NULL)');

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
