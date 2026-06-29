import { unauthenticated } from "~/shopify.server";
import {
  GET_PRODUCTS_QUERY,
  GET_SHOP_SETTINGS_QUERY,
  UPDATE_PRODUCT_MUTATION,
  UPDATE_IMAGE_MUTATION,
  UPDATE_VARIANTS_MUTATION,
  GET_SINGLE_PRODUCT_QUERY,
} from "./graphql.server";

// Helper to delay execution
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Minimal structural type for the Shopify admin GraphQL client
interface AdminGraphQLClient {
  graphql(query: string, options?: { variables?: Record<string, unknown> }): Promise<Response>;
}

interface UserError {
  field?: string | string[];
  message: string;
}

interface GraphQLResponse<TData = Record<string, unknown>> {
  data?: TData;
  errors?: Array<{ message: string }>;
}

interface PolicyRestObject {
  title: string;
  body: string;
  url?: string;
}

interface PolicyRestResponse {
  policies: PolicyRestObject[];
}

interface ProductsQueryData {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string };
    edges: Array<{ node: ShopifyProduct }>;
  };
}

interface ShopSettingsData {
  shop: ShopifySettings["shop"];
}

interface ProductUpdateData {
  productUpdate?: { userErrors: UserError[] };
}

interface ProductUpdateMediaData {
  productUpdateMedia?: { mediaUserErrors: UserError[] };
}

interface ProductVariantsBulkUpdateData {
  productVariantsBulkUpdate?: { userErrors: UserError[] };
}

// Shopify weight units accepted by ProductVariantsBulkInput.measurement.
export type WeightUnit = "GRAMS" | "KILOGRAMS" | "OUNCES" | "POUNDS";

interface SingleProductData {
  node: ShopifyProduct | null;
}

// Execute a GraphQL query with automatic retry on 429 rate limit
async function executeGraphQLWithRetry<TData = Record<string, unknown>>(
  adminClient: AdminGraphQLClient,
  query: string,
  variables: Record<string, unknown> = {},
  retries = 3
): Promise<GraphQLResponse<TData>> {
  let attempt = 0;
  while (attempt < retries) {
    try {
      const response = await adminClient.graphql(query, { variables });

      // If HTTP 429, wait and retry
      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get("Retry-After") || "2", 10);
        attempt++;
        await sleep(retryAfter * 1000 + 500);
        continue;
      }

      if (!response.ok) {
        throw new Error(`Shopify API responded with status ${response.status}`);
      }

      const json: GraphQLResponse<TData> = await response.json();

      // Check for GraphQL errors indicating throttling
      if (json.errors && json.errors.some((err) => err.message?.includes("Throttled"))) {
        attempt++;
        await sleep(2000 * attempt); // exponential backoff
        continue;
      }

      return json;
    } catch (error) {
      attempt++;
      if (attempt >= retries) throw error;
      await sleep(1000 * attempt);
    }
  }
  throw new Error("Max retries exceeded for Shopify GraphQL API call");
}

export interface ShopifyProduct {
  id: string;
  title: string;
  description: string;
  descriptionHtml: string;
  handle: string;
  vendor: string;
  productType: string;
  tags: string[];
  onlineStoreUrl: string | null;
  media: {
    edges: Array<{
      node: {
        id: string;
        mediaContentType: string;
        alt: string | null;
        image?: {
          url: string;
          width: number;
          height: number;
        } | null;
      };
    }>;
  };
  variants: {
    edges: Array<{
      node: {
        id: string;
        title: string;
        sku: string | null;
        barcode: string | null;
        price: string;
        compareAtPrice: string | null;
        inventoryQuantity: number | null;
        inventoryItem: {
          measurement: {
            weight: {
              value: number | null;
              unit: string | null;
            } | null;
          } | null;
        } | null;
      };
    }>;
  };
}

export interface ShopifySettings {
  shop: {
    name: string;
    primaryDomain: {
      url: string;
    };
  };
  refundPolicy: { title: string; body: string } | null;
  shippingPolicy: { title: string; body: string } | null;
  termsOfService: { title: string; body: string } | null;
  policiesChecked?: boolean;
}

// Match a policy by scanning its URL slug and title against keyword sets.
// URL slugs are far more reliable than merchant-localized titles, so they are
// checked first. Both English and Turkish keywords are supported.
function matchPolicy(policies: PolicyRestObject[], keywords: string[]): PolicyRestObject | undefined {
  return policies.find((p) => {
    const haystack = `${p.url || ""} ${p.title || ""}`.toLowerCase();
    return keywords.some((kw) => haystack.includes(kw));
  });
}

export class ShopifyClient {
  private shop: string;

  constructor(shop: string) {
    this.shop = shop;
  }

  // Get unauthenticated admin client
  private async getAdmin(): Promise<AdminGraphQLClient> {
    const { admin } = await unauthenticated.admin(this.shop);
    return admin;
  }

  // Fetch all products from Shopify using cursor pagination
  async fetchAllProducts(onProgress?: (fetchedCount: number) => void): Promise<ShopifyProduct[]> {
    const admin = await this.getAdmin();
    const products: ShopifyProduct[] = [];
    let hasNextPage = true;
    let endCursor: string | null = null;
    const batchSize = 50;

    while (hasNextPage) {
      const result: GraphQLResponse<ProductsQueryData> = await executeGraphQLWithRetry<ProductsQueryData>(admin, GET_PRODUCTS_QUERY, {
        first: batchSize,
        after: endCursor,
      });

      if (!result?.data?.products) {
        break;
      }

      const fetchedProducts = result.data.products.edges.map((edge) => edge.node);
      products.push(...fetchedProducts);

      if (onProgress) {
        onProgress(products.length);
      }

      hasNextPage = result.data.products.pageInfo.hasNextPage;
      endCursor = result.data.products.pageInfo.endCursor;
    }

    return products;
  }

  // Fetch store settings & policies
  async fetchSettings(): Promise<ShopifySettings> {
    const { admin, session } = await unauthenticated.admin(this.shop);
    const result = await executeGraphQLWithRetry<ShopSettingsData>(admin, GET_SHOP_SETTINGS_QUERY);
    if (!result?.data) {
      throw new Error("Failed to fetch shop settings");
    }

    let refundPolicy: ShopifySettings["refundPolicy"] = null;
    let shippingPolicy: ShopifySettings["shippingPolicy"] = null;
    let termsOfService: ShopifySettings["termsOfService"] = null;
    let policiesChecked = true;

    // Guard against an undefined session (e.g. shop uninstalled the app) so the
    // REST policy fetch degrades gracefully instead of throwing.
    const accessToken = session?.accessToken || "";

    try {
      const response = await fetch(`https://${this.shop}/admin/api/2025-10/policies.json`, {
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
      });

      if (response.ok) {
        const data: PolicyRestResponse = await response.json();
        const policies = data.policies || [];

        // Match by URL slug (reliable) + title keywords (EN/TR fallback)
        const refundObj = matchPolicy(policies, ["refund", "iade", "returns", "return"]);
        const shippingObj = matchPolicy(policies, ["shipping", "kargo", "teslimat", "delivery"]);
        const termsObj = matchPolicy(policies, ["terms", "hizmet", "kullanım", "kullanim", "sartlar", "şartlar"]);

        if (refundObj) refundPolicy = { title: refundObj.title, body: refundObj.body };
        if (shippingObj) shippingPolicy = { title: shippingObj.title, body: shippingObj.body };
        if (termsObj) termsOfService = { title: termsObj.title, body: termsObj.body };
      } else {
        policiesChecked = false;
      }
    } catch (error) {
      console.warn(`[ShopifyClient] Failed to fetch store policies via REST, ignoring:`, error);
      policiesChecked = false;
    }

    return {
      shop: result.data.shop,
      refundPolicy,
      shippingPolicy,
      termsOfService,
      policiesChecked,
    };
  }

  // Update product details (e.g. title, description, tags)
  async updateProduct(
    productId: string,
    input: { title?: string; descriptionHtml?: string; tags?: string[] }
  ): Promise<void> {
    const admin = await this.getAdmin();
    const result = await executeGraphQLWithRetry<ProductUpdateData>(admin, UPDATE_PRODUCT_MUTATION, {
      input: {
        id: productId,
        ...input,
      },
    });

    if (result.errors && result.errors.length > 0) {
      throw new Error(`Shopify GraphQL error: ${result.errors.map((e) => e.message).join(", ")}`);
    }

    const userErrors = result?.data?.productUpdate?.userErrors || [];
    if (userErrors.length > 0) {
      throw new Error(`Shopify error updating product: ${userErrors.map((e) => e.message).join(", ")}`);
    }
  }

  // Update product image alt text
  async updateImageAlt(productId: string, imageId: string, altText: string): Promise<void> {
    const admin = await this.getAdmin();
    const result = await executeGraphQLWithRetry<ProductUpdateMediaData>(admin, UPDATE_IMAGE_MUTATION, {
      productId,
      media: [{
        id: imageId,
        alt: altText,
      }],
    });

    if (result.errors && result.errors.length > 0) {
      throw new Error(`Shopify GraphQL error: ${result.errors.map((e) => e.message).join(", ")}`);
    }

    const userErrors = result?.data?.productUpdateMedia?.mediaUserErrors || [];
    if (userErrors.length > 0) {
      throw new Error(`Shopify error updating alt text: ${userErrors.map((e) => e.message).join(", ")}`);
    }
  }

  // Update a single variant's identifiers/measurements. In the 2024+ Admin API,
  // `sku` and `weight` live on the variant's inventoryItem, while `barcode` is on
  // the variant itself — productVariantsBulkUpdate accepts all three at once.
  async updateVariant(
    productId: string,
    variantId: string,
    input: { sku?: string; barcode?: string; weight?: { value: number; unit: WeightUnit } }
  ): Promise<void> {
    const admin = await this.getAdmin();

    const inventoryItem: Record<string, unknown> = {};
    if (input.sku !== undefined) inventoryItem.sku = input.sku;
    if (input.weight !== undefined) {
      inventoryItem.measurement = { weight: { value: input.weight.value, unit: input.weight.unit } };
    }

    const variant: Record<string, unknown> = { id: variantId };
    if (input.barcode !== undefined) variant.barcode = input.barcode;
    if (Object.keys(inventoryItem).length > 0) variant.inventoryItem = inventoryItem;

    const result = await executeGraphQLWithRetry<ProductVariantsBulkUpdateData>(admin, UPDATE_VARIANTS_MUTATION, {
      productId,
      variants: [variant],
    });

    if (result.errors && result.errors.length > 0) {
      throw new Error(`Shopify GraphQL error: ${result.errors.map((e) => e.message).join(", ")}`);
    }

    const userErrors = result?.data?.productVariantsBulkUpdate?.userErrors || [];
    if (userErrors.length > 0) {
      throw new Error(`Shopify error updating variant: ${userErrors.map((e) => e.message).join(", ")}`);
    }
  }

  // Fetch a single product details
  async fetchSingleProduct(productId: string): Promise<ShopifyProduct | null> {
    const admin = await this.getAdmin();
    const result = await executeGraphQLWithRetry<SingleProductData>(admin, GET_SINGLE_PRODUCT_QUERY, { id: productId });
    return result?.data?.node || null;
  }
}
