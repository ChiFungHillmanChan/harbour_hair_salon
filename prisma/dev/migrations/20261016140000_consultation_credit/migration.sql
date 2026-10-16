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
    "quoteJson" TEXT,
    "notificationLocale" TEXT,
    "reminderSent" BOOLEAN NOT NULL DEFAULT false,
    "reviewRequestSent" BOOLEAN NOT NULL DEFAULT false,
    "treatwellBookingId" TEXT,
    "treatwellSyncStatus" TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
    "treatwellSyncError" TEXT,
    "treatwellSyncedAt" DATETIME,
    "rescheduleRequestedDate" DATETIME,
    "rescheduleRequestedAt" DATETIME,
    "arrivedAt" DATETIME,
    "lateCancelledAt" DATETIME,
    "consultationCreditFromId" TEXT,
    "consultationCreditPence" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "userId" TEXT NOT NULL,
    "stylistId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "discountCodeId" TEXT,
    "notificationVersion" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Appointment_consultationCreditFromId_fkey" FOREIGN KEY ("consultationCreditFromId") REFERENCES "Appointment" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "Appointment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Appointment_stylistId_fkey" FOREIGN KEY ("stylistId") REFERENCES "Stylist" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Appointment_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Appointment_discountCodeId_fkey" FOREIGN KEY ("discountCodeId") REFERENCES "DiscountCode" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Appointment" ("arrivedAt", "createdAt", "date", "discountCodeId", "durationAtBooking", "id", "lateCancelledAt", "notes", "notificationLocale", "notificationVersion", "priceAtBooking", "quoteJson", "reminderSent", "rescheduleRequestedAt", "rescheduleRequestedDate", "reviewRequestSent", "serviceId", "status", "stylistId", "treatwellBookingId", "treatwellSyncError", "treatwellSyncStatus", "treatwellSyncedAt", "updatedAt", "userId") SELECT "arrivedAt", "createdAt", "date", "discountCodeId", "durationAtBooking", "id", "lateCancelledAt", "notes", "notificationLocale", "notificationVersion", "priceAtBooking", "quoteJson", "reminderSent", "rescheduleRequestedAt", "rescheduleRequestedDate", "reviewRequestSent", "serviceId", "status", "stylistId", "treatwellBookingId", "treatwellSyncError", "treatwellSyncStatus", "treatwellSyncedAt", "updatedAt", "userId" FROM "Appointment";
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
CREATE INDEX "Appointment_rescheduleRequestedDate_idx" ON "Appointment"("rescheduleRequestedDate");
CREATE INDEX "Appointment_consultationCreditFromId_idx" ON "Appointment"("consultationCreditFromId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

