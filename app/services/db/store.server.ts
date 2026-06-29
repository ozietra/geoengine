import prisma from "~/db.server";
import { getPrioritizedRecommendations } from "~/features/recommendations/engine.server";
import { generateAISuggestions } from "~/features/ai/pipeline.server";
import { ShopifyClient } from "~/services/shopify/client.server";
import type { PrioritizedRecommendation } from "~/features/recommendations/engine.server";
import type { Prisma } from "@prisma/client";

export async function getOrCreateStoreProfile(shop: string) {
  let profile = await prisma.storeProfile.findUnique({
    where: { shop },
  });

  if (!profile) {
    profile = await prisma.storeProfile.create({
      data: {
        shop,
        scanStatus: "IDLE",
        overallScore: 0.0,
      },
    });
  }
  return profile;
}

export async function getStoreDashboardData(shop: string) {
  const profile = await getOrCreateStoreProfile(shop);

  // Get the latest scan
  const latestScan = await prisma.scan.findFirst({
    where: { storeId: profile.id },
    orderBy: { scannedAt: "desc" },
  });

  // Get prioritized recommendations
  let recommendations: PrioritizedRecommendation[] = [];
  if (latestScan) {
    recommendations = await getPrioritizedRecommendations(latestScan.id);
  }

  // Get score history for charts (last 30 days)
  const history = await prisma.scanHistory.findMany({
    where: { storeId: profile.id },
    orderBy: { date: "asc" },
    take: 30,
  });

  // Check if merchant has applied fixes to determine review banner visibility
  const resolvedCount = await prisma.scanIssue.count({
    where: {
      productScan: {
        scan: {
          storeId: profile.id,
        },
      },
      resolved: true,
    },
  });

  // A store can be genuinely improving - actively resolving issues and
  // trending upward - while still sitting under the "Good" 50-point
  // threshold. Gating purely on the absolute score hid the banner from
  // exactly the merchants who are most actively engaging with the app. We
  // additionally surface it when the two most recent daily snapshots show a
  // real score increase alongside resolved issues, even if the absolute
  // score hasn't crossed 50 yet.
  const recentHistory = history.slice(-2);
  const [previousSnapshot, latestSnapshot] = recentHistory;
  const isImprovingTrend =
    recentHistory.length === 2 &&
    latestSnapshot.resolvedIssues > 0 &&
    latestSnapshot.overallScore > previousSnapshot.overallScore;

  return {
    profile,
    latestScan,
    recommendations,
    history,
    showReviewBanner: resolvedCount > 0 && (profile.overallScore > 50 || isImprovingTrend),
  };
}

export async function getProductScans(shop: string, options: { page?: number; search?: string; limit?: number }) {
  const profile = await getOrCreateStoreProfile(shop);
  const page = options.page || 1;
  const limit = options.limit || 20;
  const search = options.search || "";
  const skip = (page - 1) * limit;

  // Get latest scan ID
  const latestScan = await prisma.scan.findFirst({
    where: { storeId: profile.id },
    orderBy: { scannedAt: "desc" },
  });

  if (!latestScan) {
    return { products: [], totalCount: 0, totalPages: 0 };
  }

  const whereClause: Prisma.ProductScanWhereInput = {
    scanId: latestScan.id,
  };

  if (search.trim() !== "") {
    whereClause.OR = [
      { title: { contains: search } },
      { handle: { contains: search } },
    ];
  }

  const [products, totalCount] = await Promise.all([
    prisma.productScan.findMany({
      where: whereClause,
      include: {
        _count: {
          select: { issues: { where: { resolved: false } } },
        },
      },
      orderBy: { overallScore: "asc" }, // list worst products first
      skip,
      take: limit,
    }),
    prisma.productScan.count({ where: whereClause }),
  ]);

  return {
    products,
    totalCount,
    totalPages: Math.ceil(totalCount / limit),
  };
}

export async function getProductScanDetails(productScanId: string) {
  const productScan = await prisma.productScan.findUnique({
    where: { id: productScanId },
    include: {
      issues: {
        where: { resolved: false },
      },
      aiSuggestions: true,
      scan: {
        include: {
          store: true,
        },
      },
    },
  });

  if (!productScan) return null;

  // Generate suggestions if they don't exist yet
  const pendingSuggestions = productScan.aiSuggestions.filter((s) => s.status === "PENDING");
  if (productScan.issues.length > 0 && pendingSuggestions.length === 0) {
    try {
      await generateAISuggestions(productScan.id);
      // Re-fetch details with newly generated suggestions
      return prisma.productScan.findUnique({
        where: { id: productScanId },
        include: {
          issues: {
            where: { resolved: false },
          },
          aiSuggestions: true,
          scan: {
            include: {
              store: true,
            },
          },
        },
      });
    } catch (err) {
      console.error("[DbService] Error generating AI suggestions in loader:", err);
    }
  }

  return productScan;
}

export async function resolveSuggestion(
  suggestionId: string,
  status: "ACCEPTED" | "REJECTED" | "EDITED",
  editedValue?: string
) {
  const suggestion = await prisma.aISuggestion.findUnique({
    where: { id: suggestionId },
    include: {
      productScan: {
        include: {
          scan: {
            include: {
              store: true,
            },
          },
        },
      },
    },
  });

  if (!suggestion) {
    throw new Error(`AISuggestion with ID ${suggestionId} not found`);
  }

  const shop = suggestion.productScan.scan.store.shop;
  const shopifyProductId = suggestion.productScan.shopifyProductId;
  const client = new ShopifyClient(shop);

  if (status === "ACCEPTED" || status === "EDITED") {
    const finalContent = status === "EDITED" && editedValue !== undefined ? editedValue : suggestion.suggestedContent;

    if (suggestion.fieldType === "TITLE") {
      await client.updateProduct(shopifyProductId, { title: finalContent });
      // Mark title issue as resolved
      await prisma.scanIssue.updateMany({
        where: {
          productScanId: suggestion.productScanId,
          category: "TITLE",
          resolved: false,
        },
        data: {
          resolved: true,
          resolvedAt: new Date(),
        },
      });
    } else if (suggestion.fieldType === "DESCRIPTION") {
      await client.updateProduct(shopifyProductId, { descriptionHtml: finalContent });
      // Mark description issue as resolved
      await prisma.scanIssue.updateMany({
        where: {
          productScanId: suggestion.productScanId,
          category: "DESCRIPTION",
          resolved: false,
        },
        data: {
          resolved: true,
          resolvedAt: new Date(),
        },
      });
    } else if (suggestion.fieldType === "ALT_TEXT") {
      const imageId = suggestion.metafieldKey;
      if (!imageId) {
        throw new Error(`AISuggestion ${suggestionId} has fieldType ALT_TEXT but metafieldKey (imageId) is missing`);
      }
      await client.updateImageAlt(shopifyProductId, imageId, finalContent);
      // Mark specific alt text issue as resolved (or count if multiple)
      await prisma.scanIssue.updateMany({
        where: {
          productScanId: suggestion.productScanId,
          category: "MEDIA",
          type: "MISSING_ALT_TEXT",
          resolved: false,
        },
        data: {
          resolved: true,
          resolvedAt: new Date(),
        },
      });
    }

    // Update suggestion status in DB
    await prisma.aISuggestion.update({
      where: { id: suggestionId },
      data: {
        status,
        appliedAt: new Date(),
        merchantComment: status === "EDITED" ? "Merchant edited original AI suggestion" : null,
        suggestedContent: finalContent,
      },
    });

    // Run dynamic single product scan to recalculate scores instantly
    const { runSingleProductScan } = await import("~/features/scan/scanner.server");
    await runSingleProductScan(shop, suggestion.productScanId, shopifyProductId);
  } else if (status === "REJECTED") {
    await prisma.aISuggestion.update({
      where: { id: suggestionId },
      data: {
        status: "REJECTED",
      },
    });
  }
}
