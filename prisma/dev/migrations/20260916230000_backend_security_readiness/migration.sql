-- Reconcile the seven checked-in SQLite migrations with the maintained schema.
-- All existing columns/rows are copied by the generated table rebuilds below.
-- Duplicate opening hours require explicit operator resolution, never arbitrary deletion.
PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;
CREATE TEMP TABLE "_availability_migration_check" ("valid" INTEGER NOT NULL CHECK ("valid" = 1));
INSERT INTO "_availability_migration_check" ("valid")
SELECT CASE WHEN EXISTS (SELECT 1 FROM "Availability" GROUP BY "stylistId", "dayOfWeek" HAVING COUNT(*) > 1) THEN 0 ELSE 1 END;
DROP TABLE "_availability_migration_check";

-- CreateTable
CREATE TABLE "ExternalBusyBlock" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL DEFAULT 'TREATWELL',
    "externalUid" TEXT NOT NULL,
    "stylistId" TEXT NOT NULL,
    "start" DATETIME NOT NULL,
    "end" DATETIME NOT NULL,
    "summary" TEXT,
    "lastSyncAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExternalBusyBlock_stylistId_fkey" FOREIGN KEY ("stylistId") REFERENCES "Stylist" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "userId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    CONSTRAINT "Review_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Review_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ServiceCategoryContent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "hero" TEXT NOT NULL,
    "metaDescription" TEXT NOT NULL,
    "intro" TEXT NOT NULL,
    "overviewJson" TEXT NOT NULL,
    "includesJson" TEXT NOT NULL,
    "processJson" TEXT NOT NULL,
    "aftercareJson" TEXT NOT NULL,
    "faqsJson" TEXT NOT NULL,
    "relatedSlugs" TEXT NOT NULL DEFAULT '',
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SiteSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "phone" TEXT NOT NULL DEFAULT '07831 830898',
    "twitterHandle" TEXT NOT NULL DEFAULT '',
    "gscVerification" TEXT NOT NULL DEFAULT '',
    "googleBusinessUrl" TEXT NOT NULL DEFAULT 'https://www.google.com/maps/place/Harbour+Hair/data=!4m2!3m1!1s0x0:0xad74be12e1f34d1a?sa=X&ved=1t:2428&ictx=111',
    "facebookUrl" TEXT NOT NULL DEFAULT '',
    "instagramUrl" TEXT NOT NULL DEFAULT 'https://www.instagram.com/harbourhair_leeds/',
    "treatwellUrl" TEXT NOT NULL DEFAULT 'https://www.treatwell.co.uk/place/harbour-hair-hk-hair-stylist/',
    "freshaUrl" TEXT NOT NULL DEFAULT '',
    "booksyUrl" TEXT NOT NULL DEFAULT '',
    "heroEyebrow" TEXT NOT NULL DEFAULT 'Leeds City Centre',
    "heroTitleLine1" TEXT NOT NULL DEFAULT 'Expert Hair',
    "heroTitleLine2" TEXT NOT NULL DEFAULT 'Styling',
    "heroSubtitle" TEXT NOT NULL DEFAULT 'Tailored cuts, colours and grooming by Hong Kong trained stylists. Precision and artistry in every appointment.',
    "bookingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Faq" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BlogPost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "authorRole" TEXT NOT NULL,
    "publishedAt" DATETIME NOT NULL,
    "readingTime" INTEGER NOT NULL DEFAULT 5,
    "tags" TEXT NOT NULL DEFAULT '',
    "coverImage" TEXT NOT NULL,
    "coverAlt" TEXT NOT NULL,
    "lede" TEXT NOT NULL,
    "sectionsJson" TEXT NOT NULL,
    "relatedSlugs" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "pinHash" TEXT NOT NULL,
    "payType" TEXT NOT NULL DEFAULT 'HOURLY',
    "hourlyRate" DECIMAL,
    "monthlySalary" DECIMAL,
    "commissionRate" DECIMAL,
    "overtimeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "overtimeThresholdHours" DECIMAL,
    "overtimeMultiplier" DECIMAL,
    "unpaidBreakMinutes" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "hireDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "stylistId" TEXT,
    CONSTRAINT "Employee_stylistId_fkey" FOREIGN KEY ("stylistId") REFERENCES "Stylist" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TimeEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "clockIn" DATETIME NOT NULL,
    "clockOut" DATETIME,
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'KIOSK',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "editedByAdminId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TimeEntry_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PayrollPeriod" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "finalizedByAdminId" TEXT,
    "finalizedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PayrollLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "periodId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "totalHours" DECIMAL NOT NULL DEFAULT 0,
    "regularHours" DECIMAL NOT NULL DEFAULT 0,
    "overtimeHours" DECIMAL NOT NULL DEFAULT 0,
    "basePay" DECIMAL NOT NULL DEFAULT 0,
    "overtimePay" DECIMAL NOT NULL DEFAULT 0,
    "commissionableRevenue" DECIMAL NOT NULL DEFAULT 0,
    "commissionPay" DECIMAL NOT NULL DEFAULT 0,
    "adjustments" DECIMAL NOT NULL DEFAULT 0,
    "adjustmentNote" TEXT,
    "grossPay" DECIMAL NOT NULL DEFAULT 0,
    "snapshotJson" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PayrollLine_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "PayrollPeriod" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PayrollLine_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Shift" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Shift_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CalendarConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stylistId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "receivesBookings" BOOLEAN NOT NULL DEFAULT false,
    "inboundUrl" TEXT,
    "inboundEnabled" BOOLEAN NOT NULL DEFAULT false,
    "outboundConfirmedAt" DATETIME,
    "lastAttemptAt" DATETIME,
    "lastSuccessAt" DATETIME,
    "lastError" TEXT,
    "lockedUntil" DATETIME,
    "lockToken" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CalendarConnection_stylistId_fkey" FOREIGN KEY ("stylistId") REFERENCES "Stylist" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NotificationDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "appointmentId" TEXT,
    "payloadJson" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "firstAttemptAt" DATETIME,
    "nextAttemptAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" DATETIME,
    "lockToken" TEXT,
    "sentAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "NotificationDelivery_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BackgroundJobState" (
    "name" TEXT NOT NULL PRIMARY KEY,
    "lastStartedAt" DATETIME,
    "lastSucceededAt" DATETIME,
    "lastFailedAt" DATETIME,
    "lastError" TEXT,
    "lastResultJson" TEXT,
    "lockToken" TEXT,
    "lockedUntil" DATETIME,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "KioskSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deviceName" TEXT NOT NULL DEFAULT 'Salon kiosk',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    "createdByAdminId" TEXT
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "metadataJson" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Appointment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "priceAtBooking" DECIMAL,
    "durationAtBooking" INTEGER,
    "reminderSent" BOOLEAN NOT NULL DEFAULT false,
    "reviewRequestSent" BOOLEAN NOT NULL DEFAULT false,
    "treatwellBookingId" TEXT,
    "treatwellSyncStatus" TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
    "treatwellSyncError" TEXT,
    "treatwellSyncedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "userId" TEXT NOT NULL,
    "stylistId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "discountCodeId" TEXT,
    "notificationVersion" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Appointment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Appointment_stylistId_fkey" FOREIGN KEY ("stylistId") REFERENCES "Stylist" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Appointment_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Appointment_discountCodeId_fkey" FOREIGN KEY ("discountCodeId") REFERENCES "DiscountCode" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Appointment" ("createdAt", "date", "discountCodeId", "id", "notes", "serviceId", "status", "stylistId", "treatwellBookingId", "treatwellSyncError", "treatwellSyncStatus", "treatwellSyncedAt", "updatedAt", "userId") SELECT "createdAt", "date", "discountCodeId", "id", "notes", "serviceId", "status", "stylistId", "treatwellBookingId", "treatwellSyncError", "treatwellSyncStatus", "treatwellSyncedAt", "updatedAt", "userId" FROM "Appointment";
DROP TABLE "Appointment";
ALTER TABLE "new_Appointment" RENAME TO "Appointment";
CREATE INDEX "Appointment_stylistId_date_idx" ON "Appointment"("stylistId", "date");
CREATE INDEX "Appointment_userId_status_idx" ON "Appointment"("userId", "status");
CREATE INDEX "Appointment_userId_date_id_idx" ON "Appointment"("userId", "date", "id");
CREATE INDEX "Appointment_status_date_id_idx" ON "Appointment"("status", "date", "id");
CREATE INDEX "Appointment_status_reminderSent_date_idx" ON "Appointment"("status", "reminderSent", "date");
CREATE INDEX "Appointment_status_reviewRequestSent_date_idx" ON "Appointment"("status", "reviewRequestSent", "date");
CREATE INDEX "Appointment_treatwellSyncStatus_updatedAt_idx" ON "Appointment"("treatwellSyncStatus", "updatedAt");
CREATE INDEX "Appointment_date_idx" ON "Appointment"("date");
CREATE TABLE "new_Availability" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dayOfWeek" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "isOff" BOOLEAN NOT NULL DEFAULT false,
    "stylistId" TEXT NOT NULL,
    CONSTRAINT "Availability_stylistId_fkey" FOREIGN KEY ("stylistId") REFERENCES "Stylist" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Availability" ("dayOfWeek", "endTime", "id", "isOff", "startTime", "stylistId") SELECT "dayOfWeek", "endTime", "id", "isOff", "startTime", "stylistId" FROM "Availability";
DROP TABLE "Availability";
ALTER TABLE "new_Availability" RENAME TO "Availability";
CREATE UNIQUE INDEX "Availability_stylistId_dayOfWeek_key" ON "Availability"("stylistId", "dayOfWeek");
CREATE TABLE "new_Service" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL NOT NULL,
    "duration" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "calendarColor" TEXT,
    "requiresPatchTest" BOOLEAN NOT NULL DEFAULT false,
    "isPatchTest" BOOLEAN NOT NULL DEFAULT false,
    "requiresConsultation" BOOLEAN NOT NULL DEFAULT false,
    "isConsultation" BOOLEAN NOT NULL DEFAULT false,
    "imageUrl" TEXT,
    "treatwellExternalId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Service" ("calendarColor", "category", "createdAt", "description", "duration", "id", "imageUrl", "name", "price", "treatwellExternalId", "updatedAt") SELECT "calendarColor", "category", "createdAt", "description", "duration", "id", "imageUrl", "name", "price", "treatwellExternalId", "updatedAt" FROM "Service";
DROP TABLE "Service";
ALTER TABLE "new_Service" RENAME TO "Service";
CREATE TABLE "new_Stylist" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "bio" TEXT,
    "imageUrl" TEXT,
    "role" TEXT NOT NULL,
    "slug" TEXT,
    "tagline" TEXT,
    "specialtiesJson" TEXT NOT NULL DEFAULT '[]',
    "languagesJson" TEXT NOT NULL DEFAULT '[]',
    "yearsExperience" INTEGER,
    "trainedIn" TEXT,
    "extendedBioJson" TEXT NOT NULL DEFAULT '[]',
    "treatwellIcalUrl" TEXT,
    "treatwellExternalId" TEXT,
    "icalToken" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "calendarColor" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Stylist" ("bio", "calendarColor", "createdAt", "icalToken", "id", "imageUrl", "name", "role", "treatwellExternalId", "updatedAt") SELECT "bio", "calendarColor", "createdAt", "icalToken", "id", "imageUrl", "name", "role", "treatwellExternalId", "updatedAt" FROM "Stylist";
DROP TABLE "Stylist";
ALTER TABLE "new_Stylist" RENAME TO "Stylist";
CREATE UNIQUE INDEX "Stylist_slug_key" ON "Stylist"("slug");
CREATE UNIQUE INDEX "Stylist_icalToken_key" ON "Stylist"("icalToken");
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "password" TEXT,
    "name" TEXT,
    "phone" TEXT,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "mfaSecretEncrypted" TEXT,
    "mfaEnabledAt" DATETIME,
    "mfaLastUsedStep" INTEGER,
    "mfaRecoveryCodesJson" TEXT NOT NULL DEFAULT '[]',
    "mfaPendingSecretEncrypted" TEXT,
    "mfaPendingExpiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_User" ("createdAt", "email", "id", "name", "password", "phone", "role", "updatedAt") SELECT "createdAt", "email", "id", "name", "password", "phone", "role", "updatedAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "ExternalBusyBlock_stylistId_start_idx" ON "ExternalBusyBlock"("stylistId", "start");

-- CreateIndex
CREATE INDEX "ExternalBusyBlock_end_idx" ON "ExternalBusyBlock"("end");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalBusyBlock_source_stylistId_externalUid_key" ON "ExternalBusyBlock"("source", "stylistId", "externalUid");

-- CreateIndex
CREATE UNIQUE INDEX "Review_appointmentId_key" ON "Review"("appointmentId");

-- CreateIndex
CREATE INDEX "Review_status_createdAt_idx" ON "Review"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceCategoryContent_slug_key" ON "ServiceCategoryContent"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceCategoryContent_category_key" ON "ServiceCategoryContent"("category");

-- CreateIndex
CREATE INDEX "Faq_key_sortOrder_idx" ON "Faq"("key", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "BlogPost_slug_key" ON "BlogPost"("slug");

-- CreateIndex
CREATE INDEX "BlogPost_status_publishedAt_idx" ON "BlogPost"("status", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_stylistId_key" ON "Employee"("stylistId");

-- CreateIndex
CREATE INDEX "Employee_isActive_idx" ON "Employee"("isActive");

-- CreateIndex
CREATE INDEX "TimeEntry_employeeId_clockIn_idx" ON "TimeEntry"("employeeId", "clockIn");

-- CreateIndex
CREATE INDEX "TimeEntry_status_clockIn_idx" ON "TimeEntry"("status", "clockIn");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollPeriod_year_month_key" ON "PayrollPeriod"("year", "month");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollLine_periodId_employeeId_key" ON "PayrollLine"("periodId", "employeeId");

-- CreateIndex
CREATE INDEX "Shift_employeeId_date_idx" ON "Shift"("employeeId", "date");

-- CreateIndex
CREATE INDEX "Shift_date_idx" ON "Shift"("date");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");

-- CreateIndex
CREATE INDEX "CalendarConnection_inboundEnabled_idx" ON "CalendarConnection"("inboundEnabled");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarConnection_stylistId_provider_key" ON "CalendarConnection"("stylistId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationDelivery_eventKey_key" ON "NotificationDelivery"("eventKey");

-- CreateIndex
CREATE INDEX "NotificationDelivery_status_nextAttemptAt_idx" ON "NotificationDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "NotificationDelivery_appointmentId_kind_idx" ON "NotificationDelivery"("appointmentId", "kind");

-- CreateIndex
CREATE INDEX "NotificationDelivery_status_lockedAt_idx" ON "NotificationDelivery"("status", "lockedAt");

-- CreateIndex
CREATE INDEX "NotificationDelivery_status_createdAt_idx" ON "NotificationDelivery"("status", "createdAt");

-- CreateIndex
CREATE INDEX "KioskSession_revokedAt_expiresAt_idx" ON "KioskSession"("revokedAt", "expiresAt");

-- CreateIndex
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_actorUserId_createdAt_idx" ON "AuditEvent"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_targetType_targetId_idx" ON "AuditEvent"("targetType", "targetId");

COMMIT;
PRAGMA foreign_keys=ON;
