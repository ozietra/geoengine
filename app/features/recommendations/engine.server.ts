import prisma from "~/db.server";

export interface PrioritizedRecommendation {
  type: string;
  category: string;
  severity: "CRITICAL" | "WARNING" | "INFO";
  impact: "HIGH" | "MEDIUM" | "LOW";
  difficulty: "EASY" | "MEDIUM" | "HARD";
  roiScore: number;
  timeEstimatedSec: number;
  message: string;
  details: string;
  affectedCount: number;
  hasOneClickFix: boolean;
  affectedProductScans: Array<{
    id: string;
    shopifyProductId: string;
    title: string;
    handle: string;
    issueId: string;
  }>;
}

const SEVERITY_WEIGHTS = {
  CRITICAL: 10,
  WARNING: 5,
  INFO: 2,
};

const DIFFICULTY_WEIGHTS = {
  EASY: 1,
  MEDIUM: 2,
  HARD: 4,
};

export async function getPrioritizedRecommendations(scanId: string): Promise<PrioritizedRecommendation[]> {
  // Fetch all issues for this scan (product-level via productScan, and store-level via scanId)
  const issues = await prisma.scanIssue.findMany({
    where: {
      OR: [
        { productScan: { scanId } }, // Product-level issues
        { scanId },                   // Store-level policy issues (scoped to this scan)
      ],
      resolved: false,
    },
    include: {
      productScan: true,
    },
  });

  // Group issues by type
  const groupedIssues: Record<string, typeof issues> = {};
  for (const issue of issues) {
    if (!groupedIssues[issue.type]) {
      groupedIssues[issue.type] = [];
    }
    groupedIssues[issue.type].push(issue);
  }

  const recommendations: PrioritizedRecommendation[] = [];

  for (const [type, issueList] of Object.entries(groupedIssues)) {
    const templateIssue = issueList[0];
    const affectedCount = issueList.length;

    // Calculate aggregated time estimation
    const totalTime = issueList.reduce((acc, curr) => acc + curr.timeEstimatedSec, 0);

    // Get severity/difficulty weights
    const severity = templateIssue.severity as keyof typeof SEVERITY_WEIGHTS;
    const difficulty = templateIssue.difficulty as keyof typeof DIFFICULTY_WEIGHTS;

    const severityWeight = SEVERITY_WEIGHTS[severity] || 2;
    const difficultyWeight = DIFFICULTY_WEIGHTS[difficulty] || 2;

    // ROI Score calculation
    const roiScore = parseFloat((severityWeight / difficultyWeight).toFixed(2));

    // Dynamic title message based on count
    let message = templateIssue.message;
    if (affectedCount > 1) {
      if (type === "MISSING_ALT_TEXT") {
        message = `Add Alt Text to images on ${affectedCount} products`;
      } else if (type === "SHORT_TITLE") {
        message = `Expand short titles on ${affectedCount} products`;
      } else if (type === "MISSING_BARCODE") {
        message = `Add missing barcodes / GTINs on ${affectedCount} variants`;
      } else if (type === "MISSING_SKU") {
        message = `Add missing SKUs on ${affectedCount} variants`;
      } else if (type === "MISSING_WEIGHT") {
        message = `Add shipping weights on ${affectedCount} variants`;
      } else if (type === "TINY_DESCRIPTION" || type === "SHORT_DESCRIPTION") {
        message = `Enhance description lengths on ${affectedCount} products`;
      } else {
        message = `${templateIssue.message} (affects ${affectedCount} items)`;
      }
    }

    const affectedProducts = issueList
      .filter((issue) => issue.productScan)
      .map((issue) => ({
        id: issue.productScan!.id,
        shopifyProductId: issue.productScan!.shopifyProductId,
        title: issue.productScan!.title,
        handle: issue.productScan!.handle,
        issueId: issue.id,
      }));

    recommendations.push({
      type,
      category: templateIssue.category,
      severity: templateIssue.severity as PrioritizedRecommendation["severity"],
      impact: templateIssue.impact as PrioritizedRecommendation["impact"],
      difficulty: templateIssue.difficulty as PrioritizedRecommendation["difficulty"],
      roiScore,
      timeEstimatedSec: totalTime,
      message,
      details: templateIssue.details,
      affectedCount,
      hasOneClickFix: templateIssue.hasOneClickFix,
      affectedProductScans: affectedProducts,
    });
  }

  // Sort recommendations by ROI Score descending, then by severity weight descending
  return recommendations.sort((a, b) => {
    if (b.roiScore !== a.roiScore) {
      return b.roiScore - a.roiScore;
    }
    const weightA = SEVERITY_WEIGHTS[a.severity] || 0;
    const weightB = SEVERITY_WEIGHTS[b.severity] || 0;
    return weightB - weightA;
  });
}
