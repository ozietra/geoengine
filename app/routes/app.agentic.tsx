import { useRef, useState } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { generateLlmsTxt } from "~/features/agentic/llms.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  const proxyUrl = `https://${session.shop}/apps/geo/llms.txt`;

  try {
    const result = await generateLlmsTxt(session.shop);
    return {
      shop: session.shop,
      proxyUrl,
      content: result.content,
      storeName: result.storeName,
      listedProducts: result.listedProducts,
      totalProducts: result.totalProducts,
      truncated: result.truncated,
      error: null as string | null,
    };
  } catch (error) {
    console.error("[Agentic] Failed to generate llms.txt preview:", error);
    return {
      shop: session.shop,
      proxyUrl,
      content: "",
      storeName: session.shop,
      listedProducts: 0,
      totalProducts: 0,
      truncated: false,
      error: "We couldn't read your catalog yet. Run a catalog scan from the dashboard, then come back.",
    };
  }
};

export default function AgenticStorefront() {
  const { proxyUrl, content, storeName, listedProducts, totalProducts, truncated, error } =
    useLoaderData<typeof loader>();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState<"url" | "file" | null>(null);

  const flash = (which: "url" | "file") => {
    setCopied(which);
    setTimeout(() => setCopied(null), 1800);
  };

  const copyText = async (text: string, which: "url" | "file") => {
    try {
      await navigator.clipboard.writeText(text);
      flash(which);
    } catch {
      // Clipboard API is often blocked inside the embedded admin iframe —
      // fall back to selecting the textarea so the merchant can Ctrl+C.
      if (which === "file" && textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.select();
      }
    }
  };

  const downloadFile = () => {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "llms.txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <s-page heading="Agentic Storefront">
      {/* Hero / explainer */}
      <div
        style={{
          background: "linear-gradient(135deg, #0f172a 0%, #1e3a8a 55%, #2563eb 100%)",
          borderRadius: "14px",
          padding: "26px 28px",
          marginBottom: "24px",
          color: "#ffffff",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "10px" }}>
          <span style={{ display: "inline-flex" }} aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="10" rx="2" />
              <circle cx="12" cy="5" r="2" />
              <path d="M12 7v4" />
              <line x1="8" y1="16" x2="8.01" y2="16" />
              <line x1="16" y1="16" x2="16.01" y2="16" />
            </svg>
          </span>
          <span style={{ fontSize: "18px", fontWeight: 800, letterSpacing: "-0.01em" }}>
            Publish an llms.txt for your store
          </span>
        </div>
        <p style={{ margin: 0, fontSize: "13.5px", lineHeight: 1.7, color: "#dbeafe", maxWidth: "760px" }}>
          An <strong>llms.txt</strong> is the AI-era equivalent of a sitemap. It gives AI shopping
          agents and LLM search engines — ChatGPT Shopping, Gemini, Perplexity, Claude, and Google AI
          Overviews — a clean, structured summary of your catalog and policies, so they can discover,
          compare, and recommend your products accurately. GEO Engine generates it live from your real
          catalog and serves it on your own storefront domain.
        </p>
      </div>

      {/* Public URL */}
      <s-section heading="Your published llms.txt URL">
        <s-box padding="base" background="subdued" borderRadius="base">
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <p style={{ margin: 0, fontSize: "13px", color: "#4b5563" }}>
              This live URL is served from your storefront via GEO Engine's secure app proxy. Share it
              with AI crawlers or link to it from your homepage.
            </p>
            <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
              <code
                style={{
                  flex: "1 1 320px",
                  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                  fontSize: "13px",
                  background: "#0f172a",
                  color: "#7dd3fc",
                  padding: "10px 14px",
                  borderRadius: "8px",
                  overflowX: "auto",
                  whiteSpace: "nowrap",
                }}
              >
                {proxyUrl}
              </code>
              <s-button variant="secondary" onClick={() => copyText(proxyUrl, "url")}>
                {copied === "url" ? "✓ Copied" : "Copy URL"}
              </s-button>
            </div>
          </div>
        </s-box>
      </s-section>

      {/* Preview */}
      <s-section heading="Live preview">
        {error ? (
          <s-box padding="base" background="subdued" borderRadius="base">
            <p style={{ margin: 0, color: "#b45309", fontWeight: 600 }}>{error}</p>
          </s-box>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
              <span
                style={{
                  fontSize: "12px",
                  fontWeight: 700,
                  color: "#1d4ed8",
                  background: "#eff6ff",
                  padding: "4px 10px",
                  borderRadius: "12px",
                }}
              >
                {storeName}
              </span>
              <span style={{ fontSize: "12px", color: "#6b7280" }}>
                {listedProducts === totalProducts
                  ? `${totalProducts} products described`
                  : `Showing ${listedProducts} of ${totalProducts} products`}
              </span>
              {truncated && (
                <span style={{ fontSize: "11px", color: "#9ca3af" }}>
                  (catalog capped at 200 entries for AI readability)
                </span>
              )}
            </div>

            <textarea
              ref={textareaRef}
              readOnly
              value={content}
              spellCheck={false}
              style={{
                width: "100%",
                minHeight: "320px",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: "12.5px",
                lineHeight: 1.6,
                color: "#e5e7eb",
                background: "#0f172a",
                border: "1px solid #1e293b",
                borderRadius: "10px",
                padding: "16px",
                resize: "vertical",
                boxSizing: "border-box",
              }}
            />

            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <s-button onClick={() => copyText(content, "file")}>
                {copied === "file" ? "✓ Copied to clipboard" : "Copy llms.txt"}
              </s-button>
              <s-button variant="secondary" onClick={downloadFile}>
                Download llms.txt
              </s-button>
            </div>
          </div>
        )}
      </s-section>

      {/* How to publish */}
      <s-section heading="How publishing works">
        <s-box padding="base" background="subdued" borderRadius="base">
          <ol style={{ margin: 0, paddingLeft: "20px", fontSize: "13px", color: "#374151", lineHeight: 1.9 }}>
            <li>
              <strong>Zero setup.</strong> GEO Engine already serves your llms.txt at the app-proxy URL
              above — it updates automatically every time your catalog changes.
            </li>
            <li>
              <strong>Help agents find it.</strong> Add a link to{" "}
              <code style={{ fontSize: "12px" }}>/apps/geo/llms.txt</code> in your theme footer, or
              reference it from your homepage so crawlers discover it.
            </li>
            <li>
              <strong>Prefer a root file?</strong> Download the file above and upload it to your domain
              root as <code style={{ fontSize: "12px" }}>/llms.txt</code> for a static copy.
            </li>
          </ol>
        </s-box>
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
