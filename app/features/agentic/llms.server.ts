// ─────────────────────────────────────────────────────────────────────────
// Agentic Storefront — llms.txt generator
//
// Produces an `llms.txt` document (https://llmstxt.org) describing the
// merchant's storefront in a clean, machine-readable Markdown format so that
// AI shopping agents and LLM search engines (ChatGPT Shopping, Gemini,
// Perplexity, Claude, Google AI Overviews) can understand the store's
// catalog, structure, and policies.
//
// The document is generated live from the store's real Shopify catalog via
// the existing ShopifyClient, so it always reflects the current product data.
// ─────────────────────────────────────────────────────────────────────────
import { ShopifyClient, type ShopifyProduct } from "~/services/shopify/client.server";

// Hard cap on how many products we list in the file. Keeps the document a
// reasonable size for LLM context windows and bounds generation cost for very
// large catalogs. The total catalog count is still reported in the summary.
const MAX_PRODUCTS_LISTED = 200;

// Max characters of product description kept per line.
const DESCRIPTION_CHARS = 160;

export interface LlmsTxtResult {
  content: string;
  storeName: string;
  storeUrl: string;
  listedProducts: number;
  totalProducts: number;
  truncated: boolean;
}

function stripHtml(html: string): string {
  return (html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).replace(/\s+\S*$/, "").trimEnd() + "…";
}

// Lowest variant price across a product, formatted as a plain number string.
function minPrice(product: ShopifyProduct): string | null {
  const prices = (product.variants?.edges || [])
    .map((e) => parseFloat(e.node.price))
    .filter((n) => !Number.isNaN(n));
  if (prices.length === 0) return null;
  return Math.min(...prices).toFixed(2);
}

function productUrl(product: ShopifyProduct, storeUrl: string): string {
  if (product.onlineStoreUrl) return product.onlineStoreUrl;
  return `${storeUrl.replace(/\/$/, "")}/products/${product.handle}`;
}

/**
 * Builds the llms.txt document for a store from its live Shopify catalog.
 */
export async function generateLlmsTxt(shop: string): Promise<LlmsTxtResult> {
  const client = new ShopifyClient(shop);

  const [settings, allProducts] = await Promise.all([
    client.fetchSettings(),
    client.fetchAllProducts(),
  ]);

  const storeName = settings.shop?.name || shop.replace(/\.myshopify\.com$/, "");
  const storeUrl = settings.shop?.primaryDomain?.url || `https://${shop}`;

  const totalProducts = allProducts.length;
  const products = allProducts.slice(0, MAX_PRODUCTS_LISTED);
  const truncated = totalProducts > products.length;

  const lines: string[] = [];

  // ── Title + summary blockquote (llms.txt spec) ──────────────────────────
  lines.push(`# ${storeName}`);
  lines.push("");
  lines.push(
    `> ${storeName} is an online store with ${totalProducts} ${
      totalProducts === 1 ? "product" : "products"
    }. This llms.txt file helps AI shopping agents, LLM search engines, and crawlers understand the store's catalog, structure, and policies so they can accurately discover, compare, and recommend its products.`
  );
  lines.push("");

  // ── Store section ───────────────────────────────────────────────────────
  lines.push("## Store");
  lines.push("");
  lines.push(`- Name: ${storeName}`);
  lines.push(`- Storefront: ${storeUrl}`);
  lines.push(`- Total products: ${totalProducts}`);
  lines.push(`- Catalog: ${storeUrl.replace(/\/$/, "")}/collections/all`);
  lines.push(`- Optimized for AI commerce by GEO Engine (Generative Engine Optimization)`);
  lines.push("");

  // ── Products section ────────────────────────────────────────────────────
  lines.push("## Products");
  lines.push("");
  if (products.length === 0) {
    lines.push("_No published products are currently available._");
  } else {
    for (const product of products) {
      const url = productUrl(product, storeUrl);
      const desc = truncate(stripHtml(product.descriptionHtml || product.description || ""), DESCRIPTION_CHARS);
      const meta: string[] = [];
      if (product.vendor) meta.push(product.vendor);
      if (product.productType) meta.push(product.productType);
      const price = minPrice(product);
      if (price) meta.push(`from ${price}`);

      const suffix = meta.length > 0 ? ` (${meta.join(" · ")})` : "";
      const summary = desc ? `: ${desc}` : "";
      lines.push(`- [${product.title}](${url})${suffix}${summary}`);
    }
  }
  lines.push("");

  if (truncated) {
    lines.push(
      `_Showing the first ${products.length} of ${totalProducts} products. The full catalog is available at ${storeUrl.replace(/\/$/, "")}/collections/all._`
    );
    lines.push("");
  }

  // ── Policies section ────────────────────────────────────────────────────
  const policyBase = `${storeUrl.replace(/\/$/, "")}/policies`;
  const policyLinks: string[] = [];
  if (settings.refundPolicy) policyLinks.push(`- [${settings.refundPolicy.title || "Refund Policy"}](${policyBase}/refund-policy)`);
  if (settings.shippingPolicy) policyLinks.push(`- [${settings.shippingPolicy.title || "Shipping Policy"}](${policyBase}/shipping-policy)`);
  if (settings.termsOfService) policyLinks.push(`- [${settings.termsOfService.title || "Terms of Service"}](${policyBase}/terms-of-service)`);

  if (policyLinks.length > 0) {
    lines.push("## Policies");
    lines.push("");
    lines.push(...policyLinks);
    lines.push("");
  }

  // ── Notes for AI agents ─────────────────────────────────────────────────
  lines.push("## Notes for AI agents");
  lines.push("");
  lines.push("- Product titles, descriptions, media alt text, and variant specifications are continuously optimized for machine readability.");
  lines.push("- Prices and availability shown here are indicative; always confirm live values on the linked product pages.");
  lines.push("- This file is generated and maintained by GEO Engine, the AI commerce optimization app for Shopify.");
  lines.push("");

  return {
    content: lines.join("\n"),
    storeName,
    storeUrl,
    listedProducts: products.length,
    totalProducts,
    truncated,
  };
}
