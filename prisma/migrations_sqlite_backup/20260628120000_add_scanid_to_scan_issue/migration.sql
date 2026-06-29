-- Add scanId column to ScanIssue to link store-level policy issues to a specific scan
ALTER TABLE "ScanIssue" ADD COLUMN "scanId" TEXT;

-- Create index on scanId
CREATE INDEX "ScanIssue_scanId_idx" ON "ScanIssue"("scanId");
