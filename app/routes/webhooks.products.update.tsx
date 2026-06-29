import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "~/db.server";

/**
 * Webhook: products/update
 *
 * Triggered every time a merchant saves a product change in the Shopify admin
 * (title, description, images, variants, etc.).  We re-run the single-product
 * evaluation immediately so the stored scan score and issue list never go stale
 * between scheduled weekly scans.
 *
 * Shopify delivers the webhook as a JSON body where `id` is the numeric REST
 * product ID (e.g. 9876543210).  Our DB stores the GID form used by the
 * GraphQL API (gid://shopify/Product/9876543210), so we construct it here.
 *
 * Shopify retries failed webhook deliveries up to 19 times over 48 hours, so
 * we log errors but always return 200 to avoid an infinite retry storm when a
 * transient failure occurs (e.g. Shopify rate-limit on the GraphQL re-scan).
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, payload, topic } = await authenticate.webhook(request);

  console.log(`[Webhook] ${topic} received for ${shop}`);

  // Extract the numeric REST product ID from the payload
  const numericId = (payload as { id?: number }).id;
  if (!numericId) {
    console.warn(`[Webhook] products/update payload missing 'id' field for ${shop} — skipping`);
    return new Response();
  }

  // Construct the GID that matches how we store product IDs via the GraphQL API
  const shopifyProductGid = `gid://shopify/Product/${numericId}`;

  // Find the most recent ProductScan record for this product
  const productScan = await prisma.productScan.findFirst({
    where: {
      shopifyProductId: shopifyProductGid,
      scan: { store: { shop } },
    },
    orderBy: { scan: { scannedAt: "desc" } },
    select: { id: true },
  });

  if (!productScan) {
    // Product has never been scanned (may be outside the plan's product limit)
    // — nothing to invalidate.
    console.log(
      `[Webhook] No scan record found for product ${shopifyProductGid} on ${shop} — skipping re-scan`
    );
    return new Response();
  }

  // Re-run the rule engine against fresh Shopify data for just this product.
  // Dynamic import avoids a circular-dependency chain at module load time.
  try {
    const { runSingleProductScan } = await import("~/features/scan/scanner.server");
    await runSingleProductScan(shop, productScan.id, shopifyProductGid);
    console.log(
      `[Webhook] Successfully re-scanned product ${shopifyProductGid} for ${shop}`
    );
  } catch (err) {
    // Log the failure but still return 200 so Shopify does not retry infinitely.
    // The next scheduled weekly scan will eventually correct any stale data.
    console.error(
      `[Webhook] Failed to re-scan product ${shopifyProductGid} for ${shop}:`,
      err
    );
  }

  return new Response();
};
