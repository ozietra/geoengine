import { ShopifyProduct, ShopifySettings } from "~/services/shopify/client.server";

export interface EvaluatedScore {
  score: number;
  issues: Array<{
    type: string;
    category: string;
    severity: "CRITICAL" | "WARNING" | "INFO";
    impact: "HIGH" | "MEDIUM" | "LOW";
    difficulty: "EASY" | "MEDIUM" | "HARD";
    timeEstimatedSec: number;
    message: string;
    details: string;
    hasOneClickFix: boolean;
  }>;
}

// 1. Evaluate Title
export function evaluateTitle(title: string): EvaluatedScore {
  const issues: EvaluatedScore["issues"] = [];
  let score = 100;

  const trimmed = title.trim();

  // Length checks
  if (trimmed.length === 0) {
    score = 0;
    issues.push({
      type: "EMPTY_TITLE",
      category: "TITLE",
      severity: "CRITICAL",
      impact: "HIGH",
      difficulty: "EASY",
      timeEstimatedSec: 30,
      message: "Product title is empty",
      details: "AI agents cannot categorize or index a product without a title.",
      hasOneClickFix: false,
    });
    return { score, issues };
  }

  if (trimmed.length < 20) {
    score -= 30;
    issues.push({
      type: "SHORT_TITLE",
      category: "TITLE",
      severity: "WARNING",
      impact: "MEDIUM",
      difficulty: "EASY",
      timeEstimatedSec: 60,
      message: "Title is too short",
      details: `Title is only ${trimmed.length} characters. Optimal titles for AI shopping are 20-70 characters long and include brand, model, and key attributes (e.g. color, material).`,
      hasOneClickFix: true,
    });
  } else if (trimmed.length > 70) {
    score -= 15;
    issues.push({
      type: "LONG_TITLE",
      category: "TITLE",
      severity: "INFO",
      impact: "LOW",
      difficulty: "EASY",
      timeEstimatedSec: 60,
      message: "Title exceeds optimal length",
      details: `Title is ${trimmed.length} characters. Titles longer than 70 characters may get truncated in search result displays, though they provide rich context for search indexing.`,
      hasOneClickFix: true,
    });
  }

  // Promotional buzzwords check
  const buzzwords = ["best", "cheap", "amazing", "guaranteed", "percent off", "sale", "free shipping", "click here"];
  const foundBuzzwords = buzzwords.filter((word) => trimmed.toLowerCase().includes(word));
  if (foundBuzzwords.length > 0) {
    score -= foundBuzzwords.length * 10;
    issues.push({
      type: "PROMOTIONAL_TITLE",
      category: "TITLE",
      severity: "WARNING",
      impact: "MEDIUM",
      difficulty: "EASY",
      timeEstimatedSec: 60,
      message: "Title contains promotional buzzwords",
      details: `Title contains: ${foundBuzzwords.join(", ")}. AI shopping agents filter out promotional terms to avoid biased recommendations and maintain strict catalog quality matching.`,
      hasOneClickFix: true,
    });
  }

  // Keyword check (no descriptors)
  if (!trimmed.includes(" ") && trimmed.length > 0) {
    score -= 20;
    issues.push({
      type: "SINGLE_WORD_TITLE",
      category: "TITLE",
      severity: "WARNING",
      impact: "MEDIUM",
      difficulty: "EASY",
      timeEstimatedSec: 60,
      message: "Title is a single word",
      details: "Single word titles fail to specify target characteristics (like size, model, target audience) which AI systems rely on for specific matching.",
      hasOneClickFix: true,
    });
  }

  return {
    score: Math.max(0, score),
    issues,
  };
}

// 2. Evaluate Description
export function evaluateDescription(descriptionHtml: string): EvaluatedScore {
  const issues: EvaluatedScore["issues"] = [];
  let score = 100;

  const parser = descriptionHtml ? descriptionHtml.replace(/<[^>]*>/g, " ").trim() : "";
  const wordCount = parser.split(/\s+/).filter((w) => w.length > 0).length;

  if (wordCount === 0) {
    score = 0;
    issues.push({
      type: "EMPTY_DESCRIPTION",
      category: "DESCRIPTION",
      severity: "CRITICAL",
      impact: "HIGH",
      difficulty: "MEDIUM",
      timeEstimatedSec: 300,
      message: "Product description is missing",
      details: "AI agents require product text to understand use cases, features, materials, and target audiences. Without a description, the product is invisible to semantic search.",
      hasOneClickFix: true,
    });
    return { score, issues };
  }

  if (wordCount < 50) {
    score -= 40;
    issues.push({
      type: "TINY_DESCRIPTION",
      category: "DESCRIPTION",
      severity: "CRITICAL",
      impact: "HIGH",
      difficulty: "MEDIUM",
      timeEstimatedSec: 240,
      message: "Description is extremely short",
      details: `Description has only ${wordCount} words. AI crawlers prefer rich descriptions (>150 words) with structured attributes to understand what the product is and who it is for.`,
      hasOneClickFix: true,
    });
  } else if (wordCount < 150) {
    score -= 15;
    issues.push({
      type: "SHORT_DESCRIPTION",
      category: "DESCRIPTION",
      severity: "WARNING",
      impact: "MEDIUM",
      difficulty: "MEDIUM",
      timeEstimatedSec: 180,
      message: "Description could be more detailed",
      details: `Description has ${wordCount} words. Increasing length to 150+ words allows you to insert compatibility guidelines, specifications, and primary user benefits which AI searchers target.`,
      hasOneClickFix: true,
    });
  }

  // Check structure formatting (lists, bullet points, headers)
  const hasFormatting =
    descriptionHtml.includes("<ul") ||
    descriptionHtml.includes("<ol") ||
    descriptionHtml.includes("<h") ||
    descriptionHtml.includes("<br") ||
    descriptionHtml.includes("<p");

  if (!hasFormatting) {
    score -= 15;
    issues.push({
      type: "UNSTRUCTURED_DESCRIPTION",
      category: "DESCRIPTION",
      severity: "WARNING",
      impact: "LOW",
      difficulty: "EASY",
      timeEstimatedSec: 120,
      message: "Description lacks HTML structural tags",
      details: "Structured markup (bullet points, subheadings) helps LLMs parse technical specs and features cleanly without confusing terms.",
      hasOneClickFix: true,
    });
  }

  // Critical key attribute presence (checking for typical specs in text)
  const featuresToCheck = ["material", "care", "dimension", "size", "fit", "compatib", "warranty", "ingredient", "weight"];
  const foundSpecs = featuresToCheck.filter((spec) => parser.toLowerCase().includes(spec));
  if (foundSpecs.length === 0) {
    score -= 20;
    issues.push({
      type: "MISSING_SPECS_TEXT",
      category: "DESCRIPTION",
      severity: "WARNING",
      impact: "MEDIUM",
      difficulty: "MEDIUM",
      timeEstimatedSec: 240,
      message: "Description lacks technical specifications",
      details: "No references to material, dimensions, compatibility, sizing, or weight found. AI agents need structured data values to verify if a product meets a customer's specific needs.",
      hasOneClickFix: true,
    });
  }

  return {
    score: Math.max(0, score),
    issues,
  };
}

// 3. Evaluate Media Assets
export function evaluateMedia(images: ShopifyProduct["media"]["edges"]): EvaluatedScore {
  const issues: EvaluatedScore["issues"] = [];
  let score = 100;

  if (images.length === 0) {
    score = 0;
    issues.push({
      type: "NO_IMAGES",
      category: "MEDIA",
      severity: "CRITICAL",
      impact: "HIGH",
      difficulty: "MEDIUM",
      timeEstimatedSec: 180,
      message: "Product has no images",
      details: "Visual search bots and AI visual models (like GPT-4o) cannot display or recommend products without media files.",
      hasOneClickFix: false,
    });
    return { score, issues };
  }

  // Check alt texts
  const imagesWithoutAlt = images.filter((img) => !img.node.alt || img.node.alt.trim().length === 0);
  if (imagesWithoutAlt.length > 0) {
    const penalty = Math.round((imagesWithoutAlt.length / images.length) * 50);
    score -= penalty;
    issues.push({
      type: "MISSING_ALT_TEXT",
      category: "MEDIA",
      severity: "CRITICAL",
      impact: "HIGH",
      difficulty: "EASY",
      timeEstimatedSec: 45 * imagesWithoutAlt.length,
      message: `${imagesWithoutAlt.length} of ${images.length} images lack Alt text`,
      details: "Alt texts are indexed by search bots to associate visuals with terms. AI agents rely on alt text descriptions to 'see' product contents, especially in text-only models.",
      hasOneClickFix: true,
    });
  }

  // Check image resolution (pixel dimensions)
  const lowResImages = images.filter((img) => {
    const image = img.node.image;
    if (!image) return false;
    // Use explicit typeof checks instead of truthiness - a 0px width/height
    // (which Shopify can return for an image that hasn't finished processing)
    // is falsy in JS and was previously skipped entirely instead of being
    // flagged as low resolution.
    const hasWidth = typeof image.width === "number";
    const hasHeight = typeof image.height === "number";
    return (hasWidth && image.width < 1024) || (hasHeight && image.height < 1024);
  });
  if (lowResImages.length > 0) {
    score -= 10;
    issues.push({
      type: "LOW_RESOLUTION_IMAGE",
      category: "MEDIA",
      severity: "WARNING",
      impact: "LOW",
      difficulty: "HARD",
      timeEstimatedSec: 300,
      message: `${lowResImages.length} image(s) are below 1024px`,
      details: "High resolution images (at least 1024x1024px) are recommended. Low quality graphics fail visual search catalog scans and are rejected by Google Shopping integrations.",
      hasOneClickFix: false,
    });
  }

  return {
    score: Math.max(0, score),
    issues,
  };
}

// 4. Evaluate Variants
export function evaluateVariants(variants: ShopifyProduct["variants"]["edges"]): EvaluatedScore {
  const issues: EvaluatedScore["issues"] = [];
  let score = 100;

  if (variants.length === 0) {
    score = 0;
    issues.push({
      type: "NO_VARIANTS",
      category: "VARIANTS",
      severity: "CRITICAL",
      impact: "HIGH",
      difficulty: "MEDIUM",
      timeEstimatedSec: 120,
      message: "Product has no options/variants",
      details: "A product must have at least one purchase option for catalog validation.",
      hasOneClickFix: false,
    });
    return { score, issues };
  }

  const total = variants.length;
  let missingSku = 0;
  let missingBarcode = 0;
  let missingWeight = 0;
  let zeroPrice = 0;

  for (const edge of variants) {
    const v = edge.node;
    if (!v.sku || v.sku.trim() === "") missingSku++;
    if (!v.barcode || v.barcode.trim() === "") missingBarcode++;
    const weightVal = v.inventoryItem?.measurement?.weight?.value;
    if (weightVal === null || weightVal === undefined || weightVal === 0) missingWeight++;
    if (parseFloat(v.price) <= 0) zeroPrice++;
  }

  // SKU warnings
  if (missingSku > 0) {
    const pct = missingSku / total;
    score -= Math.round(pct * 25);
    issues.push({
      type: "MISSING_SKU",
      category: "VARIANTS",
      severity: "WARNING",
      impact: "MEDIUM",
      difficulty: "EASY",
      timeEstimatedSec: 60 * missingSku,
      message: `${missingSku} variant(s) missing SKUs`,
      details: "SKUs are essential identifiers for inventory synchronization and tracking. Without a SKU, inventory feeds can break, preventing AI from showing real-time availability.",
      hasOneClickFix: false,
    });
  }

  // Barcode (GTIN/UPC/EAN) warnings (extremely important for Google/Gemini shopping matching!)
  if (missingBarcode > 0) {
    const pct = missingBarcode / total;
    score -= Math.round(pct * 40); // heavily penalized
    issues.push({
      type: "MISSING_BARCODE",
      category: "VARIANTS",
      severity: "CRITICAL",
      impact: "HIGH",
      difficulty: "MEDIUM",
      timeEstimatedSec: 90 * missingBarcode,
      message: `${missingBarcode} variant(s) missing Barcodes / GTINs`,
      details: "Barcodes (like UPC, EAN, or ISBN) represent Global Trade Item Numbers (GTINs). AI search systems (e.g. Gemini, Perplexity) use GTINs to verify product authenticity and match listings against price-comparison indexes.",
      hasOneClickFix: false,
    });
  }

  // Weight warning (important for shipping rates structured data)
  if (missingWeight > 0) {
    score -= 15;
    issues.push({
      type: "MISSING_WEIGHT",
      category: "VARIANTS",
      severity: "WARNING",
      impact: "MEDIUM",
      difficulty: "EASY",
      timeEstimatedSec: 45 * missingWeight,
      message: `${missingWeight} variant(s) missing physical weights`,
      details: "Shipping weights are needed to generate accurate delivery rate schemas. AI shipping bots will exclude stores that cannot programmatically estimate shipping charges.",
      hasOneClickFix: false,
    });
  }

  // Pricing checking
  if (zeroPrice > 0) {
    score -= 30;
    issues.push({
      type: "ZERO_PRICE",
      category: "VARIANTS",
      severity: "CRITICAL",
      impact: "HIGH",
      difficulty: "EASY",
      timeEstimatedSec: 30 * zeroPrice,
      message: `${zeroPrice} variant(s) priced at $0.00`,
      details: "Zero-price listings look spammy to AI comparison bots, leading to catalog indexing bans.",
      hasOneClickFix: false,
    });
  }

  return {
    score: Math.max(0, score),
    issues,
  };
}

// 5. Evaluate Structured Data and Metafields
export function evaluateStructuredData(product: ShopifyProduct): EvaluatedScore {
  const issues: EvaluatedScore["issues"] = [];
  let score = 100;

  // Check if product type or vendor is missing
  if (!product.productType || product.productType.trim() === "") {
    score -= 20;
    issues.push({
      type: "MISSING_PRODUCT_TYPE",
      category: "STRUCTURED_DATA",
      severity: "WARNING",
      impact: "MEDIUM",
      difficulty: "EASY",
      timeEstimatedSec: 45,
      message: "Product type is not specified",
      details: "Setting the correct Product Type helps AI crawlers map items into schema.org category taxonomies.",
      hasOneClickFix: false,
    });
  }

  if (!product.vendor || product.vendor.trim() === "") {
    score -= 20;
    issues.push({
      type: "MISSING_VENDOR",
      category: "STRUCTURED_DATA",
      severity: "WARNING",
      impact: "MEDIUM",
      difficulty: "EASY",
      timeEstimatedSec: 30,
      message: "Brand/Vendor is not specified",
      details: "AI Shopping queries often include brand names (e.g. 'Nike shoes'). Missing the brand metadata dramatically reduces the chances of matching brand-filtered queries.",
      hasOneClickFix: false,
    });
  }

  // Check if product has tags
  if (product.tags.length === 0) {
    score -= 15;
    issues.push({
      type: "MISSING_TAGS",
      category: "STRUCTURED_DATA",
      severity: "INFO",
      impact: "LOW",
      difficulty: "EASY",
      timeEstimatedSec: 60,
      message: "No organization tags found",
      details: "Adding product tags (materials, target gender, collections) gives AI searchers metadata hints for filtering products.",
      hasOneClickFix: false,
    });
  }

  return {
    score: Math.max(0, score),
    issues,
  };
}

// 6. Evaluate Policies
export function evaluateStorePolicies(policies: ShopifySettings): EvaluatedScore {
  const issues: EvaluatedScore["issues"] = [];
  let score = 100;

  if (policies.policiesChecked === false) {
    return { score: 100, issues: [] };
  }

  if (!policies.shippingPolicy || !policies.shippingPolicy.body) {
    score -= 40;
    issues.push({
      type: "MISSING_SHIPPING_POLICY",
      category: "POLICY",
      severity: "CRITICAL",
      impact: "HIGH",
      difficulty: "MEDIUM",
      timeEstimatedSec: 600,
      message: "Store Shipping Policy is not configured",
      details: "AI assistants verify delivery timelines and pricing rules before recommending an online shop. A missing shipping policy prevents AI agents from validating order costs.",
      hasOneClickFix: false,
    });
  }

  if (!policies.refundPolicy || !policies.refundPolicy.body) {
    score -= 40;
    issues.push({
      type: "MISSING_REFUND_POLICY",
      category: "POLICY",
      severity: "CRITICAL",
      impact: "HIGH",
      difficulty: "MEDIUM",
      timeEstimatedSec: 600,
      message: "Store Refund Policy is not configured",
      details: "Security-conscious shopping assistants check return guidelines (e.g. '30-day money back guarantee'). Without this, the store is flagged as high-risk, lowering recommendations.",
      hasOneClickFix: false,
    });
  }

  if (!policies.termsOfService || !policies.termsOfService.body) {
    score -= 20;
    issues.push({
      type: "MISSING_TOS_POLICY",
      category: "POLICY",
      severity: "WARNING",
      impact: "MEDIUM",
      difficulty: "MEDIUM",
      timeEstimatedSec: 600,
      message: "Store Terms of Service is missing",
      details: "A terms of service page is a basic compliance element required by search crawlers and trust indexes.",
      hasOneClickFix: false,
    });
  }

  return {
    score: Math.max(0, score),
    issues,
  };
}
