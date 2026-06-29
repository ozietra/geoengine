-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreProfile" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'FREE',
    "productIdCount" INTEGER NOT NULL DEFAULT 0,
    "overallScore" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "lastScannedAt" TIMESTAMP(3),
    "scanStatus" TEXT NOT NULL DEFAULT 'IDLE',

    CONSTRAINT "StoreProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scan" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalProducts" INTEGER NOT NULL,
    "overallScore" DOUBLE PRECISION NOT NULL,
    "titleScore" DOUBLE PRECISION NOT NULL,
    "descriptionScore" DOUBLE PRECISION NOT NULL,
    "mediaScore" DOUBLE PRECISION NOT NULL,
    "variantScore" DOUBLE PRECISION NOT NULL,
    "structuredDataScore" DOUBLE PRECISION NOT NULL,
    "policyScore" DOUBLE PRECISION NOT NULL,
    "criticalIssuesCount" INTEGER NOT NULL,
    "warningIssuesCount" INTEGER NOT NULL,
    "infoIssuesCount" INTEGER NOT NULL,

    CONSTRAINT "Scan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductScan" (
    "id" TEXT NOT NULL,
    "scanId" TEXT NOT NULL,
    "shopifyProductId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "overallScore" DOUBLE PRECISION NOT NULL,
    "titleScore" DOUBLE PRECISION NOT NULL,
    "descriptionScore" DOUBLE PRECISION NOT NULL,
    "mediaScore" DOUBLE PRECISION NOT NULL,
    "variantScore" DOUBLE PRECISION NOT NULL,
    "structuredDataScore" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "ProductScan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanIssue" (
    "id" TEXT NOT NULL,
    "scanId" TEXT,
    "productScanId" TEXT,
    "type" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "impact" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "timeEstimatedSec" INTEGER NOT NULL,
    "message" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "hasOneClickFix" BOOLEAN NOT NULL DEFAULT false,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ScanIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AISuggestion" (
    "id" TEXT NOT NULL,
    "productScanId" TEXT NOT NULL,
    "fieldType" TEXT NOT NULL,
    "originalContent" TEXT,
    "suggestedContent" TEXT NOT NULL,
    "merchantComment" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "appliedAt" TIMESTAMP(3),
    "metafieldNamespace" TEXT,
    "metafieldKey" TEXT,
    "metafieldValueType" TEXT,

    CONSTRAINT "AISuggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanHistory" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "overallScore" DOUBLE PRECISION NOT NULL,
    "criticalIssues" INTEGER NOT NULL,
    "warningIssues" INTEGER NOT NULL,
    "resolvedIssues" INTEGER NOT NULL,

    CONSTRAINT "ScanHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Competitor" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Competitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitorScan" (
    "id" TEXT NOT NULL,
    "competitorId" TEXT NOT NULL,
    "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "overallScore" DOUBLE PRECISION NOT NULL,
    "completeness" DOUBLE PRECISION NOT NULL,
    "mediaScore" DOUBLE PRECISION NOT NULL,
    "structuredScore" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "CompetitorScan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StoreProfile_shop_key" ON "StoreProfile"("shop");

-- CreateIndex
CREATE INDEX "StoreProfile_shop_idx" ON "StoreProfile"("shop");

-- CreateIndex
CREATE INDEX "Scan_storeId_idx" ON "Scan"("storeId");

-- CreateIndex
CREATE INDEX "Scan_scannedAt_idx" ON "Scan"("scannedAt");

-- CreateIndex
CREATE INDEX "ProductScan_scanId_idx" ON "ProductScan"("scanId");

-- CreateIndex
CREATE INDEX "ProductScan_shopifyProductId_idx" ON "ProductScan"("shopifyProductId");

-- CreateIndex
CREATE INDEX "ScanIssue_scanId_idx" ON "ScanIssue"("scanId");

-- CreateIndex
CREATE INDEX "ScanIssue_productScanId_idx" ON "ScanIssue"("productScanId");

-- CreateIndex
CREATE INDEX "ScanIssue_severity_idx" ON "ScanIssue"("severity");

-- CreateIndex
CREATE INDEX "ScanIssue_category_idx" ON "ScanIssue"("category");

-- CreateIndex
CREATE INDEX "AISuggestion_productScanId_idx" ON "AISuggestion"("productScanId");

-- CreateIndex
CREATE INDEX "AISuggestion_status_idx" ON "AISuggestion"("status");

-- CreateIndex
CREATE INDEX "ScanHistory_storeId_idx" ON "ScanHistory"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "ScanHistory_storeId_date_key" ON "ScanHistory"("storeId", "date");

-- CreateIndex
CREATE INDEX "Competitor_storeId_idx" ON "Competitor"("storeId");

-- CreateIndex
CREATE INDEX "CompetitorScan_competitorId_idx" ON "CompetitorScan"("competitorId");

-- AddForeignKey
ALTER TABLE "Scan" ADD CONSTRAINT "Scan_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "StoreProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductScan" ADD CONSTRAINT "ProductScan_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanIssue" ADD CONSTRAINT "ScanIssue_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanIssue" ADD CONSTRAINT "ScanIssue_productScanId_fkey" FOREIGN KEY ("productScanId") REFERENCES "ProductScan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AISuggestion" ADD CONSTRAINT "AISuggestion_productScanId_fkey" FOREIGN KEY ("productScanId") REFERENCES "ProductScan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanHistory" ADD CONSTRAINT "ScanHistory_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "StoreProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Competitor" ADD CONSTRAINT "Competitor_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "StoreProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorScan" ADD CONSTRAINT "CompetitorScan_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
