BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[OAuthAccount] (
    [id] NVARCHAR(1000) NOT NULL,
    [provider] NVARCHAR(1000) NOT NULL,
    [providerAccountId] NVARCHAR(1000) NOT NULL,
    [userId] NVARCHAR(1000) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [OAuthAccount_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [OAuthAccount_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [OAuthAccount_provider_providerAccountId_key] UNIQUE NONCLUSTERED ([provider], [providerAccountId]),
    CONSTRAINT [OAuthAccount_provider_userId_key] UNIQUE NONCLUSTERED ([provider], [userId])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [OAuthAccount_userId_idx] ON [dbo].[OAuthAccount]([userId]);

-- AddForeignKey
ALTER TABLE [dbo].[OAuthAccount] ADD CONSTRAINT [OAuthAccount_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
