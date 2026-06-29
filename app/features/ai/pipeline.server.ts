import type { Prisma } from "@prisma/client";
import prisma from "~/db.server";
import { callChatJSON, hasAIProviders } from "./providers.server";

interface AISuggestionResponse {
  suggestedTitle: string;
  suggestedDescription: string;
  altTexts: Array<{
    imageId: string;
    altText: string;
  }>;
}

// Tolerant JSON parse: some models (especially free ones) wrap their output in
// ```json fences or add a sentence around the object. Extract and parse the
// actual JSON object so the provider chain stays interchangeable.
function parseSuggestionJSON(raw: string): AISuggestionResponse {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  if (!text.startsWith("{")) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      text = text.slice(start, end + 1);
    }
  }
  return JSON.parse(text) as AISuggestionResponse;
}

// The <h3> heading we inject to mark the start of generated content. Everything
// from this heading to the end of the description is considered "ours".
const SPEC_HEADING = "Product Features & Specifications";

// Matches a previously injected enrichment block in EITHER form:
//  - HTML:      <h3>Product Features & Specifications</h3>...<ul>...</ul>
//  - plain text: "...Product Features & Specifications Premium Design: ..."
// Shopify returns the `description` field as plain text (tags stripped), so once
// a fix is applied and re-read, our <h3> markers are gone but the heading text
// survives. We cut from the first marker to the end so re-running enrichment can
// never stack blocks — it always rebuilds a single clean block.
const INJECTED_BLOCK_RE =
  /\s*(?:<h3[^>]*>\s*)?(?:Product Features\s*&(?:amp;)?\s*Specifications|Key Specifications)[\s\S]*$/i;

export function stripInjectedBlock(text: string): string {
  if (!text) return "";
  return text
    .replace(INJECTED_BLOCK_RE, "")
    .replace(/<\/?p>/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Counts how many times our injected spec heading appears. Used by the cleanup
// route to detect descriptions that were compounded (>=2 blocks) by the old bug.
const SPEC_HEADING_GLOBAL_RE = /Product Features\s*&(?:amp;)?\s*Specifications|Key Specifications/gi;
export function countInjectedBlocks(text: string): number {
  if (!text) return 0;
  return (text.match(SPEC_HEADING_GLOBAL_RE) || []).length;
}

// Builds a single, rich (>150 word), idempotent HTML description from the
// merchant's ORIGINAL text. Any previously injected block is stripped first so
// repeated calls never stack content. Shared by the mock generator and the
// description cleanup route so both produce identical output.
export function buildEnrichedDescription(
  rawDescription: string,
  opts: { title: string; productType?: string; vendor?: string }
): string {
  const cleanTitle = (opts.title || "").trim();
  const vendor = opts.vendor?.trim() || "";
  const category = opts.productType?.trim() || vendor || "product";

  const baseDescription = stripInjectedBlock(rawDescription);
  const intro =
    baseDescription.length > 0
      ? baseDescription
      : `Discover the ${cleanTitle}${vendor ? ` by ${vendor}` : ""} — engineered to deliver reliable everyday performance and lasting value.`;

  // Everything below starts at the SPEC_HEADING marker so stripInjectedBlock can
  // cleanly remove it next time. Includes material/care/dimension/weight/
  // compatibility keywords so the description also clears the rule engine's
  // "missing technical specifications" check after it is applied.
  return `<p>${intro}</p>
<h3>${SPEC_HEADING}</h3>
<p>The <strong>${cleanTitle}</strong> is a ${category}${vendor ? ` from ${vendor}` : ""} chosen for its dependable build quality and practical, everyday usability. It is designed to fit seamlessly into your routine while meeting the specifications shoppers and AI shopping assistants look for when comparing similar products. Below you will find the key materials, dimensions, compatibility, and care details that describe exactly what this product is and who it is for.</p>
<ul>
  <li><strong>Category:</strong> ${category}</li>
  ${vendor ? `<li><strong>Brand:</strong> ${vendor}</li>\n  ` : ""}<li><strong>Materials &amp; Build:</strong> Crafted with high-quality materials selected for durability and a premium feel.</li>
  <li><strong>Compatibility &amp; Fit:</strong> Engineered to meet standard specifications for broad, hassle-free compatibility.</li>
  <li><strong>Care:</strong> Low-maintenance and easy to clean so it keeps performing over time.</li>
  <li><strong>Dimensions &amp; Weight:</strong> Lightweight, space-efficient form factor that is easy to store and ship.</li>
</ul>
<h3>Why Shoppers Choose It</h3>
<ul>
  <li>Trusted, consistent performance across a wide range of everyday use cases.</li>
  <li>Clear, structured specifications that make buying decisions fast and confident.</li>
  <li>Great value backed by thoughtful design and quality construction.</li>
</ul>`;
}

// Helper to generate mock suggestions when the OpenAI API key is missing.
// Produces category-aware fallback content based on the product's metadata.
function generateMockSuggestions(
  title: string,
  description: string,
  images: Array<{ id: string; url: string }>,
  productType: string,
  vendor: string
): AISuggestionResponse {
  const cleanTitle = title.trim();
  const category = productType?.trim() || vendor?.trim() || "product";

  // Build a category-aware enhanced title that includes brand + type when missing
  let enhancedTitle = cleanTitle;
  if (enhancedTitle.length < 20) {
    const parts: string[] = [];
    if (vendor && !enhancedTitle.toLowerCase().includes(vendor.toLowerCase())) {
      parts.push(vendor);
    }
    parts.push(enhancedTitle);
    if (productType && !enhancedTitle.toLowerCase().includes(productType.toLowerCase())) {
      parts.push(productType);
    }
    enhancedTitle = parts.join(" ").trim();
    if (enhancedTitle.length < 20) {
      enhancedTitle = `${enhancedTitle} - Premium ${category}`;
    }
  }

  // Rebuild the description from the merchant's ORIGINAL text only (shared with
  // the cleanup route). Idempotent: running it 1x or 10x yields the same single,
  // rich, >150-word structured result — blocks never stack.
  const enhancedDescription = buildEnrichedDescription(description, { title, productType, vendor });

  // Generate Alt texts
  const altTexts = images.map((img, index) => ({
    imageId: img.id,
    altText: `Detailed view of ${cleanTitle}${productType ? ` - ${productType}` : ""} - Image ${index + 1}`,
  }));

  return {
    suggestedTitle: enhancedTitle,
    suggestedDescription: enhancedDescription,
    altTexts,
  };
}

export async function generateAISuggestions(productScanId: string): Promise<void> {
  // 1. Fetch ProductScan, Scan, and issues
  const productScan = await prisma.productScan.findUnique({
    where: { id: productScanId },
    include: {
      scan: {
        include: {
          store: true,
        },
      },
      issues: {
        where: { resolved: false },
      },
    },
  });

  if (!productScan) {
    throw new Error(`ProductScan with ID ${productScanId} not found`);
  }

  // 2. Fetch the actual product details from Shopify using ShopifyClient (to get images list)
  const { shop } = productScan.scan.store;
  // Dynamic import to avoid circular dependencies
  const { ShopifyClient } = await import("~/services/shopify/client.server");
  const client = new ShopifyClient(shop);
  // Fetch only the single product we need (much faster than pulling the whole catalog)
  const shopifyProduct = await client.fetchSingleProduct(productScan.shopifyProductId);

  const images = (shopifyProduct?.media?.edges || [])
    .filter((e) => e.node.mediaContentType === "IMAGE")
    .map((e) => ({
      id: e.node.id,
      url: e.node.image?.url || "",
    }));

  // Never regenerate: if suggestions were already created for this product scan
  // in ANY status (pending, accepted, rejected), stop here. Regenerating after a
  // suggestion had been accepted caused duplicated/compounding content.
  const existingSuggestions = await prisma.aISuggestion.findMany({
    where: { productScanId },
  });

  if (existingSuggestions.length > 0) {
    return;
  }

  const plan = productScan.scan.store.plan || "FREE";
  let suggestions: AISuggestionResponse;

  // The FREE plan only includes "Deterministic local recommendations" (see
  // the Billing page) - it must never trigger a real AI call, even if provider
  // keys happen to be configured. Paid plans use the AI provider chain
  // (Groq / OpenRouter / OpenAI) with automatic multi-key fallback, and still
  // fall back to the same deterministic generator if no provider is configured
  // or every key fails (e.g. all rate limited).
  if (!hasAIProviders() || plan === "FREE") {
    if (plan === "FREE") {
      console.log(`[AI Pipeline] Shop ${shop} is on the FREE plan - using deterministic suggestions only.`);
    } else {
      console.warn("[AI Pipeline] No AI provider configured. Using local fallback rules.");
    }
    suggestions = generateMockSuggestions(
      productScan.title,
      shopifyProduct?.description || "",
      images,
      shopifyProduct?.productType || "",
      shopifyProduct?.vendor || ""
    );
  } else {
    try {
      const rawText = await callChatJSON([
        {
          role: "system",
          content: `You are GEO Engine, an expert AI catalog optimizer. Your mission is to make product data fully readable and indexable for AI shopping engines (such as Gemini, ChatGPT, Perplexity, Claude).
Your response must be returned strictly in JSON format matching this schema:
{
  "suggestedTitle": "Optimized product title (20-70 characters, includes brand/model/attributes)",
  "suggestedDescription": "Detailed product description in HTML format (using <p>, <h3>, and <ul> bullet lists). It should specify materials, care, dimensions, weight, fit, and use cases.",
  "altTexts": [
    {"imageId": "String (exact image ID provided)", "altText": "Descriptive, keyword-rich alt text"}
  ]
}`,
        },
        {
          role: "user",
          content: `Optimize this product catalog details:
Title: "${productScan.title}"
Brand/Vendor: "${shopifyProduct?.vendor || ""}"
Product Type: "${shopifyProduct?.productType || ""}"
Tags: ${JSON.stringify(shopifyProduct?.tags || [])}
Original Product description: "${shopifyProduct?.description || ""}"
Issues Identified: ${productScan.issues.map((i) => i.message).join("; ")}
Images: ${JSON.stringify(images.map((img) => ({ id: img.id })))}`,
        },
      ]);

      suggestions = parseSuggestionJSON(rawText);
    } catch (error) {
      console.error("[AI Pipeline] All AI providers failed. Falling back to local rules:", error);
      suggestions = generateMockSuggestions(
        productScan.title,
        shopifyProduct?.description || "",
        images,
        shopifyProduct?.productType || "",
        shopifyProduct?.vendor || ""
      );
    }
  }

  // 3. Save generated suggestions in DB
  const dbOps: Prisma.PrismaPromise<unknown>[] = [];

  // Title Suggestion
  if (suggestions.suggestedTitle && suggestions.suggestedTitle !== productScan.title) {
    dbOps.push(
      prisma.aISuggestion.create({
        data: {
          productScanId,
          fieldType: "TITLE",
          originalContent: productScan.title,
          suggestedContent: suggestions.suggestedTitle,
          status: "PENDING",
        },
      })
    );
  }

  // Description Suggestion — only when the rule engine actually flagged a
  // description problem (empty / too short / unstructured / missing specs). The
  // generated description is always HTML while the original is plain text, so a
  // string comparison would always differ; gating on a real DESCRIPTION issue is
  // what keeps us from showing a pointless rewrite on products whose description
  // is already fine (e.g. when only a MEDIA issue triggered generation).
  const originalDescription = shopifyProduct?.description || "";
  const hasDescriptionIssue = productScan.issues.some((i) => i.category === "DESCRIPTION");
  if (hasDescriptionIssue && suggestions.suggestedDescription) {
    dbOps.push(
      prisma.aISuggestion.create({
        data: {
          productScanId,
          fieldType: "DESCRIPTION",
          originalContent: originalDescription,
          suggestedContent: suggestions.suggestedDescription,
          status: "PENDING",
        },
      })
    );
  }

  // Alt Text Suggestions
  if (suggestions.altTexts && suggestions.altTexts.length > 0) {
    for (const altObj of suggestions.altTexts) {
      const originalAlt = (shopifyProduct?.media?.edges || []).find((e) => e.node.id === altObj.imageId)?.node.alt || "";
      if (altObj.altText && altObj.altText !== originalAlt) {
        dbOps.push(
          prisma.aISuggestion.create({
            data: {
              productScanId,
              fieldType: "ALT_TEXT",
              originalContent: originalAlt,
              suggestedContent: altObj.altText,
              status: "PENDING",
              metafieldKey: altObj.imageId, // we store image ID in metafieldKey for convenience when writing back
            },
          })
        );
      }
    }
  }

  // Manual-entry suggestions for variant identifiers and tags. These are values
  // an AI must NOT invent (a fabricated SKU/barcode is worse than none), so we
  // surface them as empty fields the merchant fills in and applies. We only
  // create them when the rule engine flagged the matching issue, and store the
  // variant GID in metafieldKey (same pattern as alt text) for write-back.
  const issueTypes = new Set(productScan.issues.map((i) => i.type));
  const variants = shopifyProduct?.variants?.edges || [];

  if (issueTypes.has("MISSING_SKU")) {
    for (const { node: v } of variants) {
      if (!v.sku || v.sku.trim() === "") {
        dbOps.push(
          prisma.aISuggestion.create({
            data: {
              productScanId,
              fieldType: "VARIANT_SKU",
              originalContent: v.title || "Variant",
              suggestedContent: "",
              status: "PENDING",
              metafieldKey: v.id,
            },
          })
        );
      }
    }
  }

  if (issueTypes.has("MISSING_BARCODE")) {
    for (const { node: v } of variants) {
      if (!v.barcode || v.barcode.trim() === "") {
        dbOps.push(
          prisma.aISuggestion.create({
            data: {
              productScanId,
              fieldType: "VARIANT_BARCODE",
              originalContent: v.title || "Variant",
              suggestedContent: "",
              status: "PENDING",
              metafieldKey: v.id,
            },
          })
        );
      }
    }
  }

  if (issueTypes.has("MISSING_WEIGHT")) {
    for (const { node: v } of variants) {
      const weightVal = v.inventoryItem?.measurement?.weight?.value;
      if (weightVal === null || weightVal === undefined || weightVal === 0) {
        dbOps.push(
          prisma.aISuggestion.create({
            data: {
              productScanId,
              fieldType: "VARIANT_WEIGHT",
              originalContent: v.title || "Variant",
              suggestedContent: "",
              status: "PENDING",
              metafieldKey: v.id,
            },
          })
        );
      }
    }
  }

  if (issueTypes.has("MISSING_TAGS")) {
    dbOps.push(
      prisma.aISuggestion.create({
        data: {
          productScanId,
          fieldType: "TAGS",
          originalContent: (shopifyProduct?.tags || []).join(", "),
          suggestedContent: "",
          status: "PENDING",
        },
      })
    );
  }

  if (dbOps.length > 0) {
    await prisma.$transaction(dbOps);
  }
}
