-- AlterTable
ALTER TABLE "User" ADD COLUMN     "preferredLocale" TEXT;

-- AlterTable
ALTER TABLE "Service" ADD COLUMN     "durationConfirmed" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "hairLength" TEXT,
ADD COLUMN     "isBookable" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "isPublic" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "offeringId" TEXT,
ADD COLUMN     "priceNature" TEXT NOT NULL DEFAULT 'LISTED',
ADD COLUMN     "priceNote" TEXT,
ADD COLUMN     "priceSource" TEXT,
ADD COLUMN     "priceType" TEXT NOT NULL DEFAULT 'STANDARD',
ADD COLUMN     "priceVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "priceVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "surchargeAmount" DECIMAL(65,30),
ADD COLUMN     "surchargeBaseServiceId" TEXT,
ADD COLUMN     "vatDisplay" TEXT NOT NULL DEFAULT 'UNSPECIFIED';

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "notificationLocale" TEXT,
ADD COLUMN     "quoteJson" TEXT;

-- AlterTable
ALTER TABLE "SiteSettings" ADD COLUMN     "salonNotificationLocale" TEXT NOT NULL DEFAULT 'zh-HK';

-- CreateTable
CREATE TABLE "ServiceOffering" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceOffering_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentTranslation" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "fieldsJson" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedByAdminId" TEXT,

    CONSTRAINT "ContentTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentDraft" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "baseRevision" INTEGER NOT NULL DEFAULT 0,
    "fieldsJson" TEXT NOT NULL,
    "reviewJson" TEXT NOT NULL DEFAULT '{}',
    "sharedJson" TEXT NOT NULL DEFAULT '{}',
    "updatedByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ServiceOffering_key_key" ON "ServiceOffering"("key");

-- CreateIndex
CREATE INDEX "ContentTranslation_entityType_locale_idx" ON "ContentTranslation"("entityType", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "ContentTranslation_entityType_entityId_locale_key" ON "ContentTranslation"("entityType", "entityId", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "ContentDraft_entityType_entityId_key" ON "ContentDraft"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "Service_offeringId_idx" ON "Service"("offeringId");

-- CreateIndex
CREATE INDEX "Service_isPublic_category_idx" ON "Service"("isPublic", "category");

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_offeringId_fkey" FOREIGN KEY ("offeringId") REFERENCES "ServiceOffering"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_surchargeBaseServiceId_fkey" FOREIGN KEY ("surchargeBaseServiceId") REFERENCES "Service"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

