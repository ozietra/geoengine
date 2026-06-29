-- CreateTable
CREATE TABLE "StoreProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "installedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'FREE',
    "productIdCount" INTEGER NOT NULL DEFAULT 0,
    "overallScore" REAL NOT NULL DEFAULT 0.0,
    "lastScannedAt" DATETIME,
    "scanStatus" TEXT NOT NULL DEFAULT 'IDLE'
);

-- CreateTable
CREATE TABLE "Scan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT NOT NULL,
    "scannedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalProducts" INTEGER NOT NULL,
    "overallScore" REAL NOT NULL,
    "titleScore" REAL NOT NULL,
    "descriptionScore" REAL NOT NULL,
    "mediaScore" REAL NOT NULL,
    "variantScore" REAL NOT NULL,
    "structuredDataScore" REAL NOT NULL,
    "policyScore" REAL NOT NULL,
    "criticalIssuesCount" INTEGER NOT NULL,
    "warningIssuesCount" INTEGER NOT NULL,
    "infoIssuesCount" INTEGER NOT NULL,
    CONSTRAINT "Scan_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "StoreProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProductScan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scanId" TEXT NOT NULL,
    "shopifyProductId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "overallScore" REAL NOT NULL,
    "titleScore" REAL NOT NULL,
    "descriptionScore" REAL NOT NULL,
    "mediaScore" REAL NOT NULL,
    "variantScore" REAL NOT NULL,
    "structuredDataScore" REAL NOT NULL,
    CONSTRAINT "ProductScan_scanId_fkey" FOREIGN KEY ("scanId") REFERENCES "Scan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ScanIssue" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "resolvedAt" DATETIME,
    CONSTRAINT "ScanIssue_productScanId_fkey" FOREIGN KEY ("productScanId") REFERENCES "ProductScan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AISuggestion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productScanId" TEXT NOT NULL,
    "fieldType" TEXT NOT NULL,
    "originalContent" TEXT,
    "suggestedContent" TEXT NOT NULL,
    "merchantComment" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "appliedAt" DATETIME,
    "metafieldNamespace" TEXT,
    "metafieldKey" TEXT,
    "metafieldValueType" TEXT,
    CONSTRAINT "AISuggestion_productScanId_fkey" FOREIGN KEY ("productScanId") REFERENCES "ProductScan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ScanHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "overallScore" REAL NOT NULL,
    "criticalIssues" INTEGER NOT NULL,
    "warningIssues" INTEGER NOT NULL,
    "resolvedIssues" INTEGER NOT NULL,
    CONSTRAINT "ScanHistory_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "StoreProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Competitor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storeId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Competitor_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "StoreProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CompetitorScan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "competitorId" TEXT NOT NULL,
    "scannedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "overallScore" REAL NOT NULL,
    "completeness" REAL NOT NULL,
    "mediaScore" REAL NOT NULL,
    "structuredScore" REAL NOT NULL,
    CONSTRAINT "CompetitorScan_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
