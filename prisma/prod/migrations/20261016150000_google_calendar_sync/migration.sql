BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[GoogleCalendarEvent] (
    [appointmentId] NVARCHAR(1000) NOT NULL,
    [eventId] NVARCHAR(1000) NOT NULL,
    [syncedHash] NVARCHAR(1000),
    [syncedAt] DATETIME2,
    [removed] BIT NOT NULL CONSTRAINT [GoogleCalendarEvent_removed_df] DEFAULT 0,
    [attempts] INT NOT NULL CONSTRAINT [GoogleCalendarEvent_attempts_df] DEFAULT 0,
    [lastError] NVARCHAR(MAX),
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [GoogleCalendarEvent_pkey] PRIMARY KEY CLUSTERED ([appointmentId]),
    CONSTRAINT [GoogleCalendarEvent_eventId_key] UNIQUE NONCLUSTERED ([eventId])
);

-- CreateTable
CREATE TABLE [dbo].[GoogleCalendarSyncState] (
    [id] NVARCHAR(1000) NOT NULL CONSTRAINT [GoogleCalendarSyncState_id_df] DEFAULT 'singleton',
    [channelId] NVARCHAR(1000),
    [resourceId] NVARCHAR(1000),
    [channelExpiresAt] DATETIME2,
    [lastPullAt] DATETIME2,
    [lastPullSuccessAt] DATETIME2,
    [lastPullError] NVARCHAR(MAX),
    [busyHash] NVARCHAR(1000),
    CONSTRAINT [GoogleCalendarSyncState_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- AddForeignKey
ALTER TABLE [dbo].[GoogleCalendarEvent] ADD CONSTRAINT [GoogleCalendarEvent_appointmentId_fkey] FOREIGN KEY ([appointmentId]) REFERENCES [dbo].[Appointment]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
