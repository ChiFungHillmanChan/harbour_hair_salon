-- Catch up the five checked-in legacy SQL Server migrations. Generated from a
-- reconstructed prior datamodel matching those SQL files; not executed against
-- SQL Server in this change. Validate on a restored staging database first.
-- Nullable uniqueness uses filtered indexes so multiple NULL values are valid;
-- Prisma 6 cannot express these filters, so preserve them in subsequent diffs.
BEGIN TRY

BEGIN TRAN;

-- Keep historical opening hours unchanged; resolve duplicates before retrying.
IF EXISTS (SELECT 1 FROM [dbo].[Availability] GROUP BY [stylistId], [dayOfWeek] HAVING COUNT(*) > 1)
    THROW 51000, 'Resolve duplicate stylist/day opening hours before applying this migration.', 1;

-- DropForeignKey
ALTER TABLE [dbo].[Appointment] DROP CONSTRAINT [Appointment_userId_fkey];

-- DropForeignKey
ALTER TABLE [dbo].[Availability] DROP CONSTRAINT [Availability_stylistId_fkey];

-- AlterTable
ALTER TABLE [dbo].[User] ADD [mfaEnabledAt] DATETIME2,
[mfaLastUsedStep] INT,
[mfaPendingExpiresAt] DATETIME2,
[mfaPendingSecretEncrypted] NVARCHAR(1000),
[mfaRecoveryCodesJson] NVARCHAR(max) NOT NULL CONSTRAINT [User_mfaRecoveryCodesJson_df] DEFAULT '[]',
[mfaSecretEncrypted] NVARCHAR(1000),
[sessionVersion] INT NOT NULL CONSTRAINT [User_sessionVersion_df] DEFAULT 0;

-- AlterTable
ALTER TABLE [dbo].[Stylist] ADD [extendedBioJson] NVARCHAR(1000) NOT NULL CONSTRAINT [Stylist_extendedBioJson_df] DEFAULT '[]',
[icalToken] NVARCHAR(1000),
[isActive] BIT NOT NULL CONSTRAINT [Stylist_isActive_df] DEFAULT 1,
[languagesJson] NVARCHAR(1000) NOT NULL CONSTRAINT [Stylist_languagesJson_df] DEFAULT '[]',
[slug] NVARCHAR(1000),
[specialtiesJson] NVARCHAR(1000) NOT NULL CONSTRAINT [Stylist_specialtiesJson_df] DEFAULT '[]',
[tagline] NVARCHAR(1000),
[trainedIn] NVARCHAR(1000),
[treatwellIcalUrl] NVARCHAR(1000),
[yearsExperience] INT;

-- AlterTable
ALTER TABLE [dbo].[Service] ADD [isConsultation] BIT NOT NULL CONSTRAINT [Service_isConsultation_df] DEFAULT 0,
[isPatchTest] BIT NOT NULL CONSTRAINT [Service_isPatchTest_df] DEFAULT 0,
[requiresConsultation] BIT NOT NULL CONSTRAINT [Service_requiresConsultation_df] DEFAULT 0,
[requiresPatchTest] BIT NOT NULL CONSTRAINT [Service_requiresPatchTest_df] DEFAULT 0;

-- AlterTable
ALTER TABLE [dbo].[Appointment] ADD [durationAtBooking] INT,
[notificationVersion] INT NOT NULL CONSTRAINT [Appointment_notificationVersion_df] DEFAULT 0,
[priceAtBooking] DECIMAL(32,16),
[reminderSent] BIT NOT NULL CONSTRAINT [Appointment_reminderSent_df] DEFAULT 0,
[reviewRequestSent] BIT NOT NULL CONSTRAINT [Appointment_reviewRequestSent_df] DEFAULT 0;

-- CreateTable
CREATE TABLE [dbo].[ExternalBusyBlock] (
    [id] NVARCHAR(1000) NOT NULL,
    [source] NVARCHAR(50) NOT NULL CONSTRAINT [ExternalBusyBlock_source_df] DEFAULT 'TREATWELL',
    [externalUid] NVARCHAR(400) NOT NULL,
    [stylistId] NVARCHAR(1000) NOT NULL,
    [start] DATETIME2 NOT NULL,
    [end] DATETIME2 NOT NULL,
    [summary] NVARCHAR(1000),
    [lastSyncAt] DATETIME2 NOT NULL CONSTRAINT [ExternalBusyBlock_lastSyncAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [ExternalBusyBlock_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [ExternalBusyBlock_source_stylistId_externalUid_key] UNIQUE NONCLUSTERED ([source],[stylistId],[externalUid])
);

-- CreateTable
CREATE TABLE [dbo].[Review] (
    [id] NVARCHAR(1000) NOT NULL,
    [rating] INT NOT NULL,
    [comment] NVARCHAR(1000),
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [Review_status_df] DEFAULT 'PENDING',
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Review_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    [userId] NVARCHAR(1000) NOT NULL,
    [appointmentId] NVARCHAR(1000) NOT NULL,
    CONSTRAINT [Review_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Review_appointmentId_key] UNIQUE NONCLUSTERED ([appointmentId])
);

-- CreateTable
CREATE TABLE [dbo].[ServiceCategoryContent] (
    [id] NVARCHAR(1000) NOT NULL,
    [slug] NVARCHAR(1000) NOT NULL,
    [category] NVARCHAR(1000) NOT NULL,
    [title] NVARCHAR(1000) NOT NULL,
    [hero] NVARCHAR(1000) NOT NULL,
    [metaDescription] NVARCHAR(1000) NOT NULL,
    [intro] NVARCHAR(1000) NOT NULL,
    [overviewJson] NVARCHAR(1000) NOT NULL,
    [includesJson] NVARCHAR(1000) NOT NULL,
    [processJson] NVARCHAR(1000) NOT NULL,
    [aftercareJson] NVARCHAR(1000) NOT NULL,
    [faqsJson] NVARCHAR(1000) NOT NULL,
    [relatedSlugs] NVARCHAR(1000) NOT NULL CONSTRAINT [ServiceCategoryContent_relatedSlugs_df] DEFAULT '',
    [displayOrder] INT NOT NULL CONSTRAINT [ServiceCategoryContent_displayOrder_df] DEFAULT 0,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ServiceCategoryContent_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [ServiceCategoryContent_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [ServiceCategoryContent_slug_key] UNIQUE NONCLUSTERED ([slug]),
    CONSTRAINT [ServiceCategoryContent_category_key] UNIQUE NONCLUSTERED ([category])
);

-- CreateTable
CREATE TABLE [dbo].[SiteSettings] (
    [id] NVARCHAR(1000) NOT NULL CONSTRAINT [SiteSettings_id_df] DEFAULT 'singleton',
    [phone] NVARCHAR(1000) NOT NULL CONSTRAINT [SiteSettings_phone_df] DEFAULT '07831 830898',
    [twitterHandle] NVARCHAR(1000) NOT NULL CONSTRAINT [SiteSettings_twitterHandle_df] DEFAULT '',
    [gscVerification] NVARCHAR(1000) NOT NULL CONSTRAINT [SiteSettings_gscVerification_df] DEFAULT '',
    [googleBusinessUrl] NVARCHAR(1000) NOT NULL CONSTRAINT [SiteSettings_googleBusinessUrl_df] DEFAULT 'https://www.google.com/maps/place/Harbour+Hair/data=!4m2!3m1!1s0x0:0xad74be12e1f34d1a?sa=X&ved=1t:2428&ictx=111',
    [facebookUrl] NVARCHAR(1000) NOT NULL CONSTRAINT [SiteSettings_facebookUrl_df] DEFAULT '',
    [instagramUrl] NVARCHAR(1000) NOT NULL CONSTRAINT [SiteSettings_instagramUrl_df] DEFAULT 'https://www.instagram.com/harbourhair_leeds/',
    [treatwellUrl] NVARCHAR(1000) NOT NULL CONSTRAINT [SiteSettings_treatwellUrl_df] DEFAULT 'https://www.treatwell.co.uk/place/harbour-hair-hk-hair-stylist/',
    [freshaUrl] NVARCHAR(1000) NOT NULL CONSTRAINT [SiteSettings_freshaUrl_df] DEFAULT '',
    [booksyUrl] NVARCHAR(1000) NOT NULL CONSTRAINT [SiteSettings_booksyUrl_df] DEFAULT '',
    [heroEyebrow] NVARCHAR(1000) NOT NULL CONSTRAINT [SiteSettings_heroEyebrow_df] DEFAULT 'Leeds City Centre',
    [heroTitleLine1] NVARCHAR(1000) NOT NULL CONSTRAINT [SiteSettings_heroTitleLine1_df] DEFAULT 'Expert Hair',
    [heroTitleLine2] NVARCHAR(1000) NOT NULL CONSTRAINT [SiteSettings_heroTitleLine2_df] DEFAULT 'Styling',
    [heroSubtitle] NVARCHAR(1000) NOT NULL CONSTRAINT [SiteSettings_heroSubtitle_df] DEFAULT 'Tailored cuts, colours and grooming by Hong Kong trained stylists. Precision and artistry in every appointment.',
    [bookingEnabled] BIT NOT NULL CONSTRAINT [SiteSettings_bookingEnabled_df] DEFAULT 0,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [SiteSettings_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[Faq] (
    [id] NVARCHAR(1000) NOT NULL,
    [key] NVARCHAR(1000) NOT NULL,
    [question] NVARCHAR(1000) NOT NULL,
    [answer] NVARCHAR(1000) NOT NULL,
    [sortOrder] INT NOT NULL CONSTRAINT [Faq_sortOrder_df] DEFAULT 0,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Faq_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Faq_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[BlogPost] (
    [id] NVARCHAR(1000) NOT NULL,
    [slug] NVARCHAR(1000) NOT NULL,
    [title] NVARCHAR(1000) NOT NULL,
    [description] NVARCHAR(1000) NOT NULL,
    [excerpt] NVARCHAR(1000) NOT NULL,
    [author] NVARCHAR(1000) NOT NULL,
    [authorRole] NVARCHAR(1000) NOT NULL,
    [publishedAt] DATETIME2 NOT NULL,
    [readingTime] INT NOT NULL CONSTRAINT [BlogPost_readingTime_df] DEFAULT 5,
    [tags] NVARCHAR(1000) NOT NULL CONSTRAINT [BlogPost_tags_df] DEFAULT '',
    [coverImage] NVARCHAR(1000) NOT NULL,
    [coverAlt] NVARCHAR(1000) NOT NULL,
    [lede] NVARCHAR(1000) NOT NULL,
    [sectionsJson] NVARCHAR(1000) NOT NULL,
    [relatedSlugs] NVARCHAR(1000) NOT NULL CONSTRAINT [BlogPost_relatedSlugs_df] DEFAULT '',
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [BlogPost_status_df] DEFAULT 'DRAFT',
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [BlogPost_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [BlogPost_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [BlogPost_slug_key] UNIQUE NONCLUSTERED ([slug])
);

-- CreateTable
CREATE TABLE [dbo].[Employee] (
    [id] NVARCHAR(1000) NOT NULL,
    [name] NVARCHAR(1000) NOT NULL,
    [title] NVARCHAR(1000) NOT NULL,
    [pinHash] NVARCHAR(1000) NOT NULL,
    [payType] NVARCHAR(1000) NOT NULL CONSTRAINT [Employee_payType_df] DEFAULT 'HOURLY',
    [hourlyRate] DECIMAL(32,16),
    [monthlySalary] DECIMAL(32,16),
    [commissionRate] DECIMAL(32,16),
    [overtimeEnabled] BIT NOT NULL CONSTRAINT [Employee_overtimeEnabled_df] DEFAULT 0,
    [overtimeThresholdHours] DECIMAL(32,16),
    [overtimeMultiplier] DECIMAL(32,16),
    [unpaidBreakMinutes] INT,
    [isActive] BIT NOT NULL CONSTRAINT [Employee_isActive_df] DEFAULT 1,
    [hireDate] DATETIME2 NOT NULL CONSTRAINT [Employee_hireDate_df] DEFAULT CURRENT_TIMESTAMP,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Employee_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    [stylistId] NVARCHAR(1000),
    CONSTRAINT [Employee_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[TimeEntry] (
    [id] NVARCHAR(1000) NOT NULL,
    [employeeId] NVARCHAR(1000) NOT NULL,
    [clockIn] DATETIME2 NOT NULL,
    [clockOut] DATETIME2,
    [breakMinutes] INT NOT NULL CONSTRAINT [TimeEntry_breakMinutes_df] DEFAULT 0,
    [source] NVARCHAR(1000) NOT NULL CONSTRAINT [TimeEntry_source_df] DEFAULT 'KIOSK',
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [TimeEntry_status_df] DEFAULT 'PENDING',
    [note] NVARCHAR(1000),
    [editedByAdminId] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [TimeEntry_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [TimeEntry_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[PayrollPeriod] (
    [id] NVARCHAR(1000) NOT NULL,
    [year] INT NOT NULL,
    [month] INT NOT NULL,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [PayrollPeriod_status_df] DEFAULT 'DRAFT',
    [finalizedByAdminId] NVARCHAR(1000),
    [finalizedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PayrollPeriod_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [PayrollPeriod_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [PayrollPeriod_year_month_key] UNIQUE NONCLUSTERED ([year],[month])
);

-- CreateTable
CREATE TABLE [dbo].[PayrollLine] (
    [id] NVARCHAR(1000) NOT NULL,
    [periodId] NVARCHAR(1000) NOT NULL,
    [employeeId] NVARCHAR(1000) NOT NULL,
    [totalHours] DECIMAL(32,16) NOT NULL CONSTRAINT [PayrollLine_totalHours_df] DEFAULT 0,
    [regularHours] DECIMAL(32,16) NOT NULL CONSTRAINT [PayrollLine_regularHours_df] DEFAULT 0,
    [overtimeHours] DECIMAL(32,16) NOT NULL CONSTRAINT [PayrollLine_overtimeHours_df] DEFAULT 0,
    [basePay] DECIMAL(32,16) NOT NULL CONSTRAINT [PayrollLine_basePay_df] DEFAULT 0,
    [overtimePay] DECIMAL(32,16) NOT NULL CONSTRAINT [PayrollLine_overtimePay_df] DEFAULT 0,
    [commissionableRevenue] DECIMAL(32,16) NOT NULL CONSTRAINT [PayrollLine_commissionableRevenue_df] DEFAULT 0,
    [commissionPay] DECIMAL(32,16) NOT NULL CONSTRAINT [PayrollLine_commissionPay_df] DEFAULT 0,
    [adjustments] DECIMAL(32,16) NOT NULL CONSTRAINT [PayrollLine_adjustments_df] DEFAULT 0,
    [adjustmentNote] NVARCHAR(1000),
    [grossPay] DECIMAL(32,16) NOT NULL CONSTRAINT [PayrollLine_grossPay_df] DEFAULT 0,
    [snapshotJson] NVARCHAR(1000) NOT NULL CONSTRAINT [PayrollLine_snapshotJson_df] DEFAULT '',
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PayrollLine_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [PayrollLine_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [PayrollLine_periodId_employeeId_key] UNIQUE NONCLUSTERED ([periodId],[employeeId])
);

-- CreateTable
CREATE TABLE [dbo].[Shift] (
    [id] NVARCHAR(1000) NOT NULL,
    [employeeId] NVARCHAR(1000) NOT NULL,
    [date] DATETIME2 NOT NULL,
    [startTime] NVARCHAR(1000) NOT NULL,
    [endTime] NVARCHAR(1000) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Shift_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Shift_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[PasswordResetToken] (
    [id] NVARCHAR(1000) NOT NULL,
    [tokenHash] VARCHAR(64) NOT NULL,
    [userId] NVARCHAR(1000) NOT NULL,
    [expiresAt] DATETIME2 NOT NULL,
    [usedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PasswordResetToken_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [PasswordResetToken_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [PasswordResetToken_tokenHash_key] UNIQUE NONCLUSTERED ([tokenHash])
);

-- CreateTable
CREATE TABLE [dbo].[CalendarConnection] (
    [id] NVARCHAR(1000) NOT NULL,
    [stylistId] NVARCHAR(1000) NOT NULL,
    [provider] NVARCHAR(1000) NOT NULL,
    [receivesBookings] BIT NOT NULL CONSTRAINT [CalendarConnection_receivesBookings_df] DEFAULT 0,
    [inboundUrl] NVARCHAR(max),
    [inboundEnabled] BIT NOT NULL CONSTRAINT [CalendarConnection_inboundEnabled_df] DEFAULT 0,
    [outboundConfirmedAt] DATETIME2,
    [lastAttemptAt] DATETIME2,
    [lastSuccessAt] DATETIME2,
    [lastError] NVARCHAR(max),
    [lockedUntil] DATETIME2,
    [lockToken] NVARCHAR(1000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [CalendarConnection_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [CalendarConnection_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [CalendarConnection_stylistId_provider_key] UNIQUE NONCLUSTERED ([stylistId],[provider])
);

-- CreateTable
CREATE TABLE [dbo].[NotificationDelivery] (
    [id] NVARCHAR(1000) NOT NULL,
    [eventKey] NVARCHAR(1000) NOT NULL,
    [kind] NVARCHAR(1000) NOT NULL,
    [appointmentId] NVARCHAR(1000),
    [payloadJson] NVARCHAR(max) NOT NULL,
    [status] NVARCHAR(1000) NOT NULL CONSTRAINT [NotificationDelivery_status_df] DEFAULT 'PENDING',
    [attempts] INT NOT NULL CONSTRAINT [NotificationDelivery_attempts_df] DEFAULT 0,
    [firstAttemptAt] DATETIME2,
    [nextAttemptAt] DATETIME2 NOT NULL CONSTRAINT [NotificationDelivery_nextAttemptAt_df] DEFAULT CURRENT_TIMESTAMP,
    [lockedAt] DATETIME2,
    [lockToken] NVARCHAR(1000),
    [sentAt] DATETIME2,
    [lastError] NVARCHAR(max),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [NotificationDelivery_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [NotificationDelivery_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [NotificationDelivery_eventKey_key] UNIQUE NONCLUSTERED ([eventKey])
);

-- CreateTable
CREATE TABLE [dbo].[BackgroundJobState] (
    [name] NVARCHAR(1000) NOT NULL,
    [lastStartedAt] DATETIME2,
    [lastSucceededAt] DATETIME2,
    [lastFailedAt] DATETIME2,
    [lastError] NVARCHAR(max),
    [lastResultJson] NVARCHAR(max),
    [lockToken] NVARCHAR(1000),
    [lockedUntil] DATETIME2,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [BackgroundJobState_pkey] PRIMARY KEY CLUSTERED ([name])
);

-- CreateTable
CREATE TABLE [dbo].[KioskSession] (
    [id] NVARCHAR(128) NOT NULL,
    [deviceName] NVARCHAR(128) NOT NULL CONSTRAINT [KioskSession_deviceName_df] DEFAULT 'Salon kiosk',
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [KioskSession_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [expiresAt] DATETIME2 NOT NULL,
    [revokedAt] DATETIME2,
    [createdByAdminId] NVARCHAR(128),
    CONSTRAINT [KioskSession_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[AuditEvent] (
    [id] NVARCHAR(128) NOT NULL,
    [actorUserId] NVARCHAR(128),
    [action] NVARCHAR(128) NOT NULL,
    [targetType] NVARCHAR(64) NOT NULL,
    [targetId] NVARCHAR(128),
    [metadataJson] NVARCHAR(max) NOT NULL CONSTRAINT [AuditEvent_metadataJson_df] DEFAULT '{}',
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [AuditEvent_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [AuditEvent_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ExternalBusyBlock_stylistId_start_idx] ON [dbo].[ExternalBusyBlock]([stylistId], [start]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ExternalBusyBlock_end_idx] ON [dbo].[ExternalBusyBlock]([end]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Review_status_createdAt_idx] ON [dbo].[Review]([status], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Faq_key_sortOrder_idx] ON [dbo].[Faq]([key], [sortOrder]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BlogPost_status_publishedAt_idx] ON [dbo].[BlogPost]([status], [publishedAt]);

-- SQL Server treats NULL as a unique value; allow multiple unlinked employees.
CREATE UNIQUE NONCLUSTERED INDEX [Employee_stylistId_key] ON [dbo].[Employee]([stylistId]) WHERE [stylistId] IS NOT NULL;

-- CreateIndex
CREATE NONCLUSTERED INDEX [Employee_isActive_idx] ON [dbo].[Employee]([isActive]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [TimeEntry_employeeId_clockIn_idx] ON [dbo].[TimeEntry]([employeeId], [clockIn]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [TimeEntry_status_clockIn_idx] ON [dbo].[TimeEntry]([status], [clockIn]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Shift_employeeId_date_idx] ON [dbo].[Shift]([employeeId], [date]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Shift_date_idx] ON [dbo].[Shift]([date]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PasswordResetToken_userId_idx] ON [dbo].[PasswordResetToken]([userId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PasswordResetToken_expiresAt_idx] ON [dbo].[PasswordResetToken]([expiresAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CalendarConnection_inboundEnabled_idx] ON [dbo].[CalendarConnection]([inboundEnabled]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [NotificationDelivery_status_nextAttemptAt_idx] ON [dbo].[NotificationDelivery]([status], [nextAttemptAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [NotificationDelivery_appointmentId_kind_idx] ON [dbo].[NotificationDelivery]([appointmentId], [kind]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [NotificationDelivery_status_lockedAt_idx] ON [dbo].[NotificationDelivery]([status], [lockedAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [NotificationDelivery_status_createdAt_idx] ON [dbo].[NotificationDelivery]([status], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [KioskSession_revokedAt_expiresAt_idx] ON [dbo].[KioskSession]([revokedAt], [expiresAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AuditEvent_createdAt_idx] ON [dbo].[AuditEvent]([createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AuditEvent_actorUserId_createdAt_idx] ON [dbo].[AuditEvent]([actorUserId], [createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AuditEvent_targetType_targetId_idx] ON [dbo].[AuditEvent]([targetType], [targetId]);

-- CreateIndex
CREATE UNIQUE NONCLUSTERED INDEX [Stylist_slug_key] ON [dbo].[Stylist]([slug]) WHERE [slug] IS NOT NULL;

-- CreateIndex
CREATE UNIQUE NONCLUSTERED INDEX [Stylist_icalToken_key] ON [dbo].[Stylist]([icalToken]) WHERE [icalToken] IS NOT NULL;

-- CreateIndex
CREATE NONCLUSTERED INDEX [Appointment_stylistId_date_idx] ON [dbo].[Appointment]([stylistId], [date]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Appointment_userId_status_idx] ON [dbo].[Appointment]([userId], [status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Appointment_userId_date_id_idx] ON [dbo].[Appointment]([userId], [date], [id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Appointment_status_date_id_idx] ON [dbo].[Appointment]([status], [date], [id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Appointment_status_reminderSent_date_idx] ON [dbo].[Appointment]([status], [reminderSent], [date]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Appointment_status_reviewRequestSent_date_idx] ON [dbo].[Appointment]([status], [reviewRequestSent], [date]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Appointment_date_idx] ON [dbo].[Appointment]([date]);

-- CreateIndex
ALTER TABLE [dbo].[Availability] ADD CONSTRAINT [Availability_stylistId_dayOfWeek_key] UNIQUE NONCLUSTERED ([stylistId], [dayOfWeek]);

-- AddForeignKey
ALTER TABLE [dbo].[Appointment] ADD CONSTRAINT [Appointment_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[ExternalBusyBlock] ADD CONSTRAINT [ExternalBusyBlock_stylistId_fkey] FOREIGN KEY ([stylistId]) REFERENCES [dbo].[Stylist]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[Review] ADD CONSTRAINT [Review_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Review] ADD CONSTRAINT [Review_appointmentId_fkey] FOREIGN KEY ([appointmentId]) REFERENCES [dbo].[Appointment]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[Availability] ADD CONSTRAINT [Availability_stylistId_fkey] FOREIGN KEY ([stylistId]) REFERENCES [dbo].[Stylist]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[Employee] ADD CONSTRAINT [Employee_stylistId_fkey] FOREIGN KEY ([stylistId]) REFERENCES [dbo].[Stylist]([id]) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[TimeEntry] ADD CONSTRAINT [TimeEntry_employeeId_fkey] FOREIGN KEY ([employeeId]) REFERENCES [dbo].[Employee]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[PayrollLine] ADD CONSTRAINT [PayrollLine_periodId_fkey] FOREIGN KEY ([periodId]) REFERENCES [dbo].[PayrollPeriod]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[PayrollLine] ADD CONSTRAINT [PayrollLine_employeeId_fkey] FOREIGN KEY ([employeeId]) REFERENCES [dbo].[Employee]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[Shift] ADD CONSTRAINT [Shift_employeeId_fkey] FOREIGN KEY ([employeeId]) REFERENCES [dbo].[Employee]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[PasswordResetToken] ADD CONSTRAINT [PasswordResetToken_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[CalendarConnection] ADD CONSTRAINT [CalendarConnection_stylistId_fkey] FOREIGN KEY ([stylistId]) REFERENCES [dbo].[Stylist]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[NotificationDelivery] ADD CONSTRAINT [NotificationDelivery_appointmentId_fkey] FOREIGN KEY ([appointmentId]) REFERENCES [dbo].[Appointment]([id]) ON DELETE NO ACTION ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
