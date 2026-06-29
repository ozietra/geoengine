import prisma from "~/db.server";
import { ShopifyClient } from "~/services/shopify/client.server";
import {
  type EvaluatedScore,
  evaluateTitle,
  evaluateDescription,
  evaluateMedia,
  evaluateVariants,
  evaluateStructuredData,
  evaluateStorePolicies,
} from "./rules.server";

// Max product counts per plan
const PLAN_PRODUCT_LIMITS: Record<string, number> = {
  FREE: 5,
  STARTER: 100,
  GROWTH: 1000,
  UNLIMITED: Infinity,
};

// How many over-limit products to persist as "locked" rows for the upgrade
// prompt. The true total is tracked on StoreProfile.productIdCount; this only
// bounds how many locked rows we store/show so a huge catalog on a small plan
// doesn't create unbounded DB rows.
const LOCKED_STORE_CAP = 100;

// How many completed scans to keep per store (older ones are deleted)
const MAX_SCANS_TO_KEEP = 30;

export async function runCatalogScan(shop: string): Promise<void> {
  console.log(`[Scanner] Initializing scan for ${shop}...`);

  // 1. Get the store profile
  let storeProfile = await prisma.storeProfile.findUnique({
    where: { shop },
  });

  if (!storeProfile) {
    storeProfile = await prisma.storeProfile.create({
      data: {
        shop,
        scanStatus: "SCANNING",
        lastScannedAt: new Date(),
      },
    });
  } else {
    await prisma.storeProfile.update({
      where: { id: storeProfile.id },
      data: { scanStatus: "SCANNING", lastScannedAt: new Date() },
    });
  }

  try {
    const client = new ShopifyClient(shop);

    // 2. Fetch products and settings
    console.log(`[Scanner] Fetching store settings for ${shop}...`);
    const settings = await client.fetchSettings();

    console.log(`[Scanner] Fetching all products for ${shop}...`);
    const allProducts = await client.fetchAllProducts();
    const plan = storeProfile.plan || "FREE";
    const productLimit = PLAN_PRODUCT_LIMITS[plan] ?? 5;
    // Deterministic order so the SAME products stay unlocked across re-scans. A
    // merchant on a limited plan must not be able to rotate which products are
    // free by rescanning (which would let them fix the whole catalog for free).
    const sortedProducts = [...allProducts].sort((a, b) => a.id.localeCompare(b.id));
    const products = isFinite(productLimit) ? sortedProducts.slice(0, productLimit) : sortedProducts;
    // Over-limit products are persisted as locked upgrade prompts (capped).
    const lockedProducts = isFinite(productLimit)
      ? sortedProducts.slice(productLimit, productLimit + LOCKED_STORE_CAP)
      : [];
    console.log(
      `[Scanner] Plan: ${plan} — scanning ${products.length} of ${allProducts.length} products (${lockedProducts.length} locked rows stored).`
    );

    // 3. Evaluate store-wide policies
    const policyEvaluation = evaluateStorePolicies(settings);

    // 4. Set up tracking aggregators
    let sumTitle = 0;
    let sumDescription = 0;
    let sumMedia = 0;
    let sumVariants = 0;
    let sumStructuredData = 0;

    let criticalCount = 0;
    let warningCount = 0;
    let infoCount = 0;

    const productEvaluations: Array<{
      shopifyProductId: string;
      title: string;
      handle: string;
      overallScore: number;
      titleScore: number;
      descriptionScore: number;
      mediaScore: number;
      variantScore: number;
      structuredDataScore: number;
      issues: EvaluatedScore["issues"];
    }> = [];

    // Evaluate each product
    for (const product of products) {
      const formattedImages = (product.media?.edges || []).filter(
        (edge) => edge.node.mediaContentType === "IMAGE"
      );

      const titleEval = evaluateTitle(product.title);
      const descEval = evaluateDescription(product.descriptionHtml);
      const mediaEval = evaluateMedia(formattedImages);
      const variantEval = evaluateVariants(product.variants.edges);
      const structEval = evaluateStructuredData(product);

      sumTitle += titleEval.score;
      sumDescription += descEval.score;
      sumMedia += mediaEval.score;
      sumVariants += variantEval.score;
      sumStructuredData += structEval.score;

      // Product overall score is average of its parts
      const pOverall = Math.round(
        (titleEval.score + descEval.score + mediaEval.score + variantEval.score + structEval.score) / 5
      );

      const allProductIssues = [
        ...titleEval.issues,
        ...descEval.issues,
        ...mediaEval.issues,
        ...variantEval.issues,
        ...structEval.issues,
      ];

      for (const issue of allProductIssues) {
        if (issue.severity === "CRITICAL") criticalCount++;
        else if (issue.severity === "WARNING") warningCount++;
        else infoCount++;
      }

      productEvaluations.push({
        shopifyProductId: product.id,
        title: product.title,
        handle: product.handle,
        overallScore: pOverall,
        titleScore: titleEval.score,
        descriptionScore: descEval.score,
        mediaScore: mediaEval.score,
        variantScore: variantEval.score,
        structuredDataScore: structEval.score,
        issues: allProductIssues,
      });
    }

    // 5. Calculate averages
    const totalCount = products.length;
    const avgTitle = totalCount > 0 ? sumTitle / totalCount : 100;
    const avgDescription = totalCount > 0 ? sumDescription / totalCount : 100;
    const avgMedia = totalCount > 0 ? sumMedia / totalCount : 100;
    const avgVariants = totalCount > 0 ? sumVariants / totalCount : 100;
    const avgStructuredData = totalCount > 0 ? sumStructuredData / totalCount : 100;
    const policyScore = policyEvaluation.score;

    // Overall catalog score is weighted average
    // Weights: Title (15%), Description (20%), Media (20%), Variants (15%), Structured (15%), Policies (15%)
    const storeOverallScore = Math.round(
      avgTitle * 0.15 +
        avgDescription * 0.2 +
        avgMedia * 0.2 +
        avgVariants * 0.15 +
        avgStructuredData * 0.15 +
        policyScore * 0.15
    );

    // Count policy issues
    for (const issue of policyEvaluation.issues) {
      if (issue.severity === "CRITICAL") criticalCount++;
      else if (issue.severity === "WARNING") warningCount++;
      else infoCount++;
    }

    // 6. DB operations - create Scan record
    console.log(`[Scanner] Writing scan results to database...`);
    const scan = await prisma.scan.create({
      data: {
        storeId: storeProfile.id,
        totalProducts: totalCount,
        overallScore: storeOverallScore,
        titleScore: Math.round(avgTitle),
        descriptionScore: Math.round(avgDescription),
        mediaScore: Math.round(avgMedia),
        variantScore: Math.round(avgVariants),
        structuredDataScore: Math.round(avgStructuredData),
        policyScore: Math.round(policyScore),
        criticalIssuesCount: criticalCount,
        warningIssuesCount: warningCount,
        infoIssuesCount: infoCount,
      },
    });

    // Write policy/store-wide issues linked to the new scan.
    if (policyEvaluation.issues.length > 0) {
      await prisma.scanIssue.createMany({
        data: policyEvaluation.issues.map((issue) => ({
          scanId: scan.id,
          type: issue.type,
          category: issue.category,
          severity: issue.severity,
          impact: issue.impact,
          difficulty: issue.difficulty,
          timeEstimatedSec: issue.timeEstimatedSec,
          message: issue.message,
          details: issue.details,
          hasOneClickFix: issue.hasOneClickFix,
        })),
      });
    }

    // Write product scans in chunks of 50 to prevent DB bottleneck
    const chunkSize = 50;
    for (let i = 0; i < productEvaluations.length; i += chunkSize) {
      const chunk = productEvaluations.slice(i, i + chunkSize);

      await Promise.all(
        chunk.map(async (pEval) => {
          const createdProductScan = await prisma.productScan.create({
            data: {
              scanId: scan.id,
              shopifyProductId: pEval.shopifyProductId,
              title: pEval.title,
              handle: pEval.handle,
              overallScore: pEval.overallScore,
              titleScore: pEval.titleScore,
              descriptionScore: pEval.descriptionScore,
              mediaScore: pEval.mediaScore,
              variantScore: pEval.variantScore,
              structuredDataScore: pEval.structuredDataScore,
            },
          });

          if (pEval.issues.length > 0) {
            await prisma.scanIssue.createMany({
              data: pEval.issues.map((issue) => ({
                productScanId: createdProductScan.id,
                type: issue.type,
                category: issue.category,
                severity: issue.severity,
                impact: issue.impact,
                difficulty: issue.difficulty,
                timeEstimatedSec: issue.timeEstimatedSec,
                message: issue.message,
                details: issue.details,
                hasOneClickFix: issue.hasOneClickFix,
              })),
            });
          }
        })
      );
    }

    // 6b. Persist locked (over-limit) products as minimal rows. They are never
    // scored or issue-scanned — just listed as an upgrade prompt. createMany is
    // used since they carry no issues/suggestions.
    if (lockedProducts.length > 0) {
      await prisma.productScan.createMany({
        data: lockedProducts.map((p) => ({
          scanId: scan.id,
          shopifyProductId: p.id,
          title: p.title,
          handle: p.handle,
          locked: true,
          overallScore: 0,
          titleScore: 0,
          descriptionScore: 0,
          mediaScore: 0,
          variantScore: 0,
          structuredDataScore: 0,
        })),
      });
    }

    // 7. Update Store Profile status to COMPLETED. productIdCount is the TRUE
    // catalog total (incl. locked) so the UI can show "X of Y, upgrade to unlock".
    await prisma.storeProfile.update({
      where: { id: storeProfile.id },
      data: {
        scanStatus: "COMPLETED",
        overallScore: storeOverallScore,
        productIdCount: allProducts.length,
        lastScannedAt: new Date(),
      },
    });

    // 8. Update Scan History (daily aggregator)
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Count issues resolved since the previous scan (best-effort, relative metric)
    const previousHistory = await prisma.scanHistory.findFirst({
      where: { storeId: storeProfile.id, date: { lt: today } },
      orderBy: { date: "desc" },
    });
    const previousTotal = previousHistory
      ? previousHistory.criticalIssues + previousHistory.warningIssues
      : 0;
    const resolvedIssues = Math.max(0, previousTotal - (criticalCount + warningCount));

    await prisma.scanHistory.upsert({
      where: {
        storeId_date: {
          storeId: storeProfile.id,
          date: today,
        },
      },
      create: {
        storeId: storeProfile.id,
        date: today,
        overallScore: storeOverallScore,
        criticalIssues: criticalCount,
        warningIssues: warningCount,
        resolvedIssues,
      },
      update: {
        overallScore: storeOverallScore,
        criticalIssues: criticalCount,
        warningIssues: warningCount,
        resolvedIssues,
      },
    });

    console.log(`[Scanner] Scan completed successfully for ${shop}. Overall score: ${storeOverallScore}`);

    // 9. Prune old scans: keep only the most recent MAX_SCANS_TO_KEEP per store
    //    Cascade deletes on Scan handle all child records (ProductScan, ScanIssue, AISuggestion).
    const oldScans = await prisma.scan.findMany({
      where: { storeId: storeProfile.id },
      orderBy: { scannedAt: "desc" },
      skip: MAX_SCANS_TO_KEEP,
      select: { id: true },
    });
    if (oldScans.length > 0) {
      await prisma.scan.deleteMany({
        where: { id: { in: oldScans.map((s) => s.id) } },
      });
      console.log(`[Scanner] Pruned ${oldScans.length} old scan(s) for ${shop}.`);
    }
  } catch (error) {
    console.error(`[Scanner] Scan failed for ${shop}:`, error);
    await prisma.storeProfile.update({
      where: { id: storeProfile.id },
      data: { scanStatus: "FAILED" },
    });
    throw error;
  }
}

export async function runSingleProductScan(
  shop: string,
  productScanId: string,
  shopifyProductId: string
): Promise<void> {
  console.log(`[Scanner] Initializing single product scan for ${shopifyProductId} on ${shop}...`);
  const client = new ShopifyClient(shop);
  
  // 1. Fetch updated product data from Shopify
  const product = await client.fetchSingleProduct(shopifyProductId);
  if (!product) {
    console.warn(`[Scanner] Product ${shopifyProductId} not found on Shopify, skipping single scan.`);
    return;
  }

  // 2. Format images for rules engine
  const formattedImages = (product.media?.edges || []).filter(
    (edge) => edge.node.mediaContentType === "IMAGE"
  );

  // 3. Evaluate rules
  const titleEval = evaluateTitle(product.title);
  const descEval = evaluateDescription(product.descriptionHtml);
  const mediaEval = evaluateMedia(formattedImages);
  const variantEval = evaluateVariants(product.variants.edges);
  const structEval = evaluateStructuredData(product);

  const pOverall = Math.round(
    (titleEval.score + descEval.score + mediaEval.score + variantEval.score + structEval.score) / 5
  );

  const allProductIssues = [
    ...titleEval.issues,
    ...descEval.issues,
    ...mediaEval.issues,
    ...variantEval.issues,
    ...structEval.issues,
  ];

  // 4. Update the existing ProductScan in DB
  await prisma.productScan.update({
    where: { id: productScanId },
    data: {
      title: product.title,
      overallScore: pOverall,
      titleScore: titleEval.score,
      descriptionScore: descEval.score,
      mediaScore: mediaEval.score,
      variantScore: variantEval.score,
      structuredDataScore: structEval.score,
    },
  });

  // 5. Update issues: delete old unresolved ones, add new ones
  await prisma.scanIssue.deleteMany({
    where: {
      productScanId,
      resolved: false,
    },
  });

  if (allProductIssues.length > 0) {
    await prisma.scanIssue.createMany({
      data: allProductIssues.map((issue) => ({
        productScanId,
        type: issue.type,
        category: issue.category,
        severity: issue.severity,
        impact: issue.impact,
        difficulty: issue.difficulty,
        timeEstimatedSec: issue.timeEstimatedSec,
        message: issue.message,
        details: issue.details,
        hasOneClickFix: issue.hasOneClickFix,
      })),
    });
  }

  // 6. Recalculate store profile score
  const currentProductScan = await prisma.productScan.findUnique({
    where: { id: productScanId },
    select: { scanId: true },
  });

  if (currentProductScan?.scanId) {
    const allScans = await prisma.productScan.findMany({
      // Exclude locked (over-limit) products: they are unscored placeholders and
      // would drag the store average toward 0.
      where: { scanId: currentProductScan.scanId, locked: false },
      select: { overallScore: true, titleScore: true, descriptionScore: true, mediaScore: true, variantScore: true, structuredDataScore: true },
    });

    const totalCount = allScans.length;
    if (totalCount > 0) {
      const avgOverall = allScans.reduce((sum, s) => sum + s.overallScore, 0) / totalCount;
      const avgTitle = allScans.reduce((sum, s) => sum + s.titleScore, 0) / totalCount;
      const avgDescription = allScans.reduce((sum, s) => sum + s.descriptionScore, 0) / totalCount;
      const avgMedia = allScans.reduce((sum, s) => sum + s.mediaScore, 0) / totalCount;
      const avgVariants = allScans.reduce((sum, s) => sum + s.variantScore, 0) / totalCount;
      const avgStructuredData = allScans.reduce((sum, s) => sum + s.structuredDataScore, 0) / totalCount;

      const parentScan = await prisma.scan.findUnique({
        where: { id: currentProductScan.scanId },
        select: { policyScore: true },
      });

      // Use ?? not ||: a genuine policyScore of 0 (every store policy missing) is
      // valid and must be kept. With || a 0 would wrongly fall back to 100, which
      // inflated the live store score after applying product fixes and made it
      // disagree with the next full catalog scan.
      const policyScore = parentScan?.policyScore ?? 100;

      const storeOverallScore = Math.round(
        avgTitle * 0.15 +
          avgDescription * 0.2 +
          avgMedia * 0.2 +
          avgVariants * 0.15 +
          avgStructuredData * 0.15 +
          policyScore * 0.15
      );

      // Recalculate issue counts to stay in sync after product changes
      const allUnresolvedIssues = await prisma.scanIssue.findMany({
        where: {
          OR: [
            { productScan: { scanId: currentProductScan.scanId } },
            { scanId: currentProductScan.scanId },
          ],
          resolved: false,
        },
        select: { severity: true },
      });

      let newCriticalCount = 0;
      let newWarningCount = 0;
      let newInfoCount = 0;
      for (const issue of allUnresolvedIssues) {
        if (issue.severity === "CRITICAL") newCriticalCount++;
        else if (issue.severity === "WARNING") newWarningCount++;
        else newInfoCount++;
      }

      await prisma.scan.update({
        where: { id: currentProductScan.scanId },
        data: {
          overallScore: storeOverallScore,
          titleScore: Math.round(avgTitle),
          descriptionScore: Math.round(avgDescription),
          mediaScore: Math.round(avgMedia),
          variantScore: Math.round(avgVariants),
          structuredDataScore: Math.round(avgStructuredData),
          criticalIssuesCount: newCriticalCount,
          warningIssuesCount: newWarningCount,
          infoIssuesCount: newInfoCount,
        },
      });

      await prisma.storeProfile.update({
        where: { shop },
        data: {
          overallScore: storeOverallScore,
        },
      });
    }
  }
}
