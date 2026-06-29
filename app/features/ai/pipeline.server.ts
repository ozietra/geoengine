import type { Prisma } from "@prisma/client";
import prisma from "~/db.server";

interface AISuggestionResponse {
  suggestedTitle: string;
  suggestedDescription: string;
  altTexts: Array<{
    imageId: string;
    altText: string;
  }>;
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

  // Format description in HTML
  let enhancedDescription = description;
  if (!description || description.trim().length === 0) {
    enhancedDescription = `<p>Discover the <strong>${cleanTitle}</strong>${vendor ? ` by ${vendor}` : ""}. Designed to deliver reliable performance and lasting value for everyday use.</p>
<h3>Key Specifications</h3>
<ul>
  <li><strong>Type:</strong> ${category}</li>
  <li><strong>Quality:</strong> Crafted with premium materials for long-lasting durability</li>
  <li><strong>Use Case:</strong> Suitable for a wide range of everyday applications</li>
</ul>`;
  } else if (!description.includes("<ul>") && !description.includes("<p>")) {
    enhancedDescription = `<p>${description}</p>
<h3>Product Features & Specifications</h3>
<ul>
  <li><strong>Premium Design:</strong> Crafted with high-quality materials for long-lasting use.</li>
  <li><strong>Optimized Compatibility:</strong> Engineered to meet standard user specifications.</li>
  <li><strong>Dimensions & Weight:</strong> Lightweight form factor, easy to store and ship.</li>
</ul>`;
  }

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

  // Check if we already have pending suggestions
  const existingSuggestions = await prisma.aISuggestion.findMany({
    where: {
      productScanId,
      status: "PENDING",
    },
  });

  if (existingSuggestions.length > 0) {
    // Already generated suggestions
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const plan = productScan.scan.store.plan || "FREE";
  let suggestions: AISuggestionResponse;

  // The FREE plan only includes "Deterministic local recommendations" (see
  // the Billing page) - it must never trigger a real (paid) AI call, even if
  // OPENAI_API_KEY happens to be configured in this environment. Paid plans
  // still fall back to the same deterministic generator if the key is
  // missing or the OpenAI call fails.
  if (!apiKey || plan === "FREE") {
    if (plan === "FREE") {
      console.log(`[AI Pipeline] Shop ${shop} is on the FREE plan - using deterministic suggestions only.`);
    } else {
      console.warn("[AI Pipeline] OPENAI_API_KEY is not defined. Using local fallback rules.");
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
      const payload = {
        model: "gpt-4o-mini",
        messages: [
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
        ],
        response_format: { type: "json_object" },
      };

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`OpenAI HTTP Error: ${response.status}`);
      }

      const responseJson = await response.json();
      const rawText = responseJson.choices?.[0]?.message?.content;
      if (!rawText || typeof rawText !== "string") {
        throw new Error("OpenAI returned an empty or invalid response");
      }
      suggestions = JSON.parse(rawText) as AISuggestionResponse;
    } catch (error) {
      console.error("[AI Pipeline] Failed to generate suggestions via OpenAI. Falling back to local rules:", error);
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

  // Description Suggestion
  if (suggestions.suggestedDescription) {
    dbOps.push(
      prisma.aISuggestion.create({
        data: {
          productScanId,
          fieldType: "DESCRIPTION",
          originalContent: shopifyProduct?.description || "",
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

  if (dbOps.length > 0) {
    await prisma.$transaction(dbOps);
  }
}
