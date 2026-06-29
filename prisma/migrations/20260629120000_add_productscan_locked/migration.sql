-- Add locked flag for over-plan-limit products (listed but not scored/scanned)
ALTER TABLE "ProductScan" ADD COLUMN "locked" BOOLEAN NOT NULL DEFAULT false;

-- Index to filter locked/unlocked product scans efficiently
CREATE INDEX "ProductScan_locked_idx" ON "ProductScan"("locked");
