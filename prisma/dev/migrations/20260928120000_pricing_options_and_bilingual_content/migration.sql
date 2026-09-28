-- AlterTable
ALTER TABLE "User" ADD COLUMN "preferredLocale" TEXT;

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN "notificationLocale" TEXT;
ALTER TABLE "Appointment" ADD COLUMN "quoteJson" TEXT;

-- CreateTable
CREATE TABLE "ServiceOffering" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ContentTranslation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "fieldsJson" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "publishedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedByAdminId" TEXT
);

-- CreateTable
CREATE TABLE "ContentDraft" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "baseRevision" INTEGER NOT NULL DEFAULT 0,
    "fieldsJson" TEXT NOT NULL,
    "reviewJson" TEXT NOT NULL DEFAULT '{}',
    "sharedJson" TEXT NOT NULL DEFAULT '{}',
    "updatedByAdminId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "offeringId" TEXT,
    "hairLength" TEXT,
    "priceType" TEXT NOT NULL DEFAULT 'STANDARD',
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "isBookable" BOOLEAN NOT NULL DEFAULT true,
    "priceVersion" INTEGER NOT NULL DEFAULT 1,
    "vatDisplay" TEXT NOT NULL DEFAULT 'UNSPECIFIED',
    "priceNature" TEXT NOT NULL DEFAULT 'LISTED',
    "durationConfirmed" BOOLEAN NOT NULL DEFAULT true,
    "surchargeBaseServiceId" TEXT,
    "surchargeAmount" DECIMAL,
    "priceNote" TEXT,
    "priceSource" TEXT,
    "priceVerifiedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Service_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "ServiceOffering" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Service_surchargeBaseServiceId_fkey" FOREIGN KEY ("surchargeBaseServiceId") REFERENCES "Service" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);
INSERT INTO "new_Service" ("calendarColor", "category", "createdAt", "description", "duration", "id", "imageUrl", "isConsultation", "isPatchTest", "name", "price", "requiresConsultation", "requiresPatchTest", "treatwellExternalId", "updatedAt") SELECT "calendarColor", "category", "createdAt", "description", "duration", "id", "imageUrl", "isConsultation", "isPatchTest", "name", "price", "requiresConsultation", "requiresPatchTest", "treatwellExternalId", "updatedAt" FROM "Service";
DROP TABLE "Service";
ALTER TABLE "new_Service" RENAME TO "Service";
CREATE INDEX "Service_offeringId_idx" ON "Service"("offeringId");
CREATE INDEX "Service_isPublic_category_idx" ON "Service"("isPublic", "category");
CREATE TABLE "new_SiteSettings" (
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
    "salonNotificationLocale" TEXT NOT NULL DEFAULT 'zh-HK',
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_SiteSettings" ("bookingEnabled", "booksyUrl", "facebookUrl", "freshaUrl", "googleBusinessUrl", "gscVerification", "heroEyebrow", "heroSubtitle", "heroTitleLine1", "heroTitleLine2", "id", "instagramUrl", "phone", "treatwellUrl", "twitterHandle", "updatedAt") SELECT "bookingEnabled", "booksyUrl", "facebookUrl", "freshaUrl", "googleBusinessUrl", "gscVerification", "heroEyebrow", "heroSubtitle", "heroTitleLine1", "heroTitleLine2", "id", "instagramUrl", "phone", "treatwellUrl", "twitterHandle", "updatedAt" FROM "SiteSettings";
DROP TABLE "SiteSettings";
ALTER TABLE "new_SiteSettings" RENAME TO "SiteSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "ServiceOffering_key_key" ON "ServiceOffering"("key");

-- CreateIndex
CREATE INDEX "ContentTranslation_entityType_locale_idx" ON "ContentTranslation"("entityType", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "ContentTranslation_entityType_entityId_locale_key" ON "ContentTranslation"("entityType", "entityId", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "ContentDraft_entityType_entityId_key" ON "ContentDraft"("entityType", "entityId");

