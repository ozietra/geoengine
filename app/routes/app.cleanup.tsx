import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useRouteError, useSubmit, useActionData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { ShopifyClient } from "~/services/shopify/client.server";
import { countInjectedBlocks, buildEnrichedDescription } from "~/features/ai/pipeline.server";

/**
 * One-off maintenance screen to repair product descriptions that were
 * "compounded" by an earlier bug, where the AI suggestion's feature block was
 * re-appended on every apply/re-scan (producing the same "Product Features &
 * Specifications" block stacked 2, 3, or more times).
 *
 * A description is considered affected when our injected spec heading appears
 * MORE THAN ONCE. The repair strips every injected block back to the merchant's
 * original text and rebuilds a single clean, rich description via the shared
 * buildEnrichedDescription helper, then writes it back to Shopify.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const client = new ShopifyClient(session.shop);
  const products = await client.fetchAllProducts();

  const affected = products
    .filter((p) => countInjectedBlocks(p.descriptionHtml) >= 2)
    .map((p) => ({
      id: p.id,
      title: p.title,
      blocks: countInjectedBlocks(p.descriptionHtml),
    }));

  return { totalProducts: products.length, affected };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const client = new ShopifyClient(session.shop);

  try {
    const products = await client.fetchAllProducts();
    const affected = products.filter((p) => countInjectedBlocks(p.descriptionHtml) >= 2);

    let repaired = 0;
    const failures: string[] = [];

    for (const product of affected) {
      const cleaned = buildEnrichedDescription(product.descriptionHtml, {
        title: product.title,
        productType: product.productType,
        vendor: product.vendor,
      });
      try {
        await client.updateProduct(product.id, { descriptionHtml: cleaned });
        repaired++;
      } catch (err) {
        console.error(`[Cleanup] Failed to repair ${product.id}:`, err);
        failures.push(product.title);
      }
    }

    return {
      success: true,
      repaired,
      failures,
    };
  } catch (error) {
    console.error("[Cleanup] Repair run failed:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: message };
  }
};

export default function CleanupPage() {
  const { totalProducts, affected } = useLoaderData<typeof loader>();
  const actionData = useActionData<{
    success: boolean;
    repaired?: number;
    failures?: string[];
    error?: string;
  }>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isRunning = navigation.state !== "idle";

  const runRepair = () => {
    if (isRunning) return;
    submit(new FormData(), { method: "post" });
  };

  return (
    <s-page heading="Description Repair">
      <s-link href="/app/products" slot="breadcrumb-actions">
        Back to Products
      </s-link>

      {actionData?.success === true && (
        <div
          style={{
            padding: "12px 16px",
            backgroundColor: "#f0fdf4",
            border: "1px solid #86efac",
            borderRadius: "6px",
            color: "#15803d",
            fontSize: "13px",
            marginBottom: "16px",
            fontWeight: "500",
          }}
        >
          Repaired {actionData.repaired} product description(s).
          {actionData.failures && actionData.failures.length > 0
            ? ` Failed: ${actionData.failures.join(", ")}.`
            : " Re-scan your catalog to refresh scores."}
        </div>
      )}

      {actionData?.success === false && (
        <div
          style={{
            padding: "12px 16px",
            backgroundColor: "#fef2f2",
            border: "1px solid #fca5a5",
            borderRadius: "6px",
            color: "#b91c1c",
            fontSize: "13px",
            marginBottom: "16px",
            fontWeight: "500",
          }}
        >
          Repair failed: {actionData.error}
        </div>
      )}

      <s-section heading="Compounded Descriptions">
        <s-box padding="base" background="subdued" borderRadius="base">
          <p style={{ margin: 0, fontSize: "13px", color: "#4b5563" }}>
            Scanned {totalProducts} product(s). Found <strong>{affected.length}</strong> with a
            duplicated &ldquo;Product Features &amp; Specifications&rdquo; block from the earlier bug.
          </p>
          <p style={{ margin: "8px 0 0", fontSize: "12px", color: "#9ca3af" }}>
            Note: this tool only repairs that one specific duplicated-description bug. It is not a
            general issue scanner — to see products with missing SKUs, short descriptions, alt text,
            etc., open the <strong>Products directory</strong> and each product&rsquo;s AI Suggestions.
          </p>
        </s-box>

        {affected.length > 0 && (
          <div style={{ marginTop: "12px" }}>
            <s-stack direction="block" gap="base">
              {affected.map((p) => (
                <div
                  key={p.id}
                  style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: "8px",
                    padding: "10px 14px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    fontSize: "13px",
                  }}
                >
                  <span style={{ fontWeight: "600" }}>{p.title}</span>
                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: "700",
                      padding: "2px 8px",
                      borderRadius: "4px",
                      backgroundColor: "#fef2f2",
                      color: "#ef4444",
                    }}
                  >
                    {p.blocks}× blocks
                  </span>
                </div>
              ))}
            </s-stack>

            <div style={{ marginTop: "16px", display: "flex", justifyContent: "flex-end" }}>
              <s-button variant="primary" onClick={runRepair} {...(isRunning ? { disabled: true } : {})}>
                {isRunning ? "Repairing…" : `Repair ${affected.length} description(s)`}
              </s-button>
            </div>
          </div>
        )}

        {affected.length === 0 && (
          <div style={{ marginTop: "12px" }}>
            <s-box padding="base" background="subdued" borderRadius="base">
              <p style={{ color: "#10b981", fontWeight: "600", textAlign: "center", margin: 0 }}>
                No compounded descriptions found. Nothing to repair.
              </p>
            </s-box>
          </div>
        )}
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
