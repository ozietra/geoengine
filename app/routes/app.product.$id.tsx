import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useRouteError, useSubmit, useActionData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { useState } from "react";
import { authenticate } from "../shopify.server";
import { getProductScanDetails, resolveSuggestion } from "~/services/db/store.server";

/**
 * Basic HTML sanitizer that strips script tags, event handlers, and dangerous
 * attributes while preserving safe formatting tags (p, h3, ul, li, strong, br).
 * This prevents XSS when rendering merchant-controlled HTML from Shopify.
 */
function sanitizeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<script[\s\S]*?\/>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript\s*:/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<object[\s\S]*?<\/object>/gi, "")
    .replace(/<embed[\s\S]*?\/?>/gi, "")
    .replace(/<form[\s\S]*?<\/form>/gi, "");
}

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const id = params.id;
  if (!id) {
    throw new Error("No product ID specified");
  }

  const details = await getProductScanDetails(id);
  if (!details) {
    throw new Response("Product scan detail not found", { status: 404 });
  }

  return { details };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  await authenticate.admin(request);
  const formData = await request.formData();
  const suggestionId = formData.get("suggestionId") as string;
  const status = formData.get("status") as "ACCEPTED" | "REJECTED" | "EDITED";
  const editedValue = formData.get("editedValue") as string;

  if (!suggestionId || !status) {
    return { success: false, error: "Missing suggestion parameters" };
  }

  try {
    await resolveSuggestion(suggestionId, status, editedValue);
    return { success: true };
  } catch (error) {
    console.error("[ProductDetailAction] Resolve suggestion error:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: message };
  }
};

export default function ProductDetail() {
  const { details } = useLoaderData<typeof loader>();
  const actionData = useActionData<{ success: boolean; error?: string }>();
  const submit = useSubmit();
  const navigation = useNavigation();

  // True while a suggestion submit is in flight (action running + loader
  // revalidating). Drives the "recalculating" score indicator and disables the
  // buttons so a fix can't be applied twice before the score refreshes.
  const isApplying = navigation.state !== "idle";

  // State to hold edits for suggestion values locally
  const [editedValues, setEditedValues] = useState<Record<string, string>>({});

  const handleSuggestionAction = (suggestionId: string, status: "ACCEPTED" | "REJECTED" | "EDITED") => {
    if (isApplying) return;
    const formData = new FormData();
    formData.set("suggestionId", suggestionId);
    formData.set("status", status);
    
    if (status === "EDITED") {
      const val = editedValues[suggestionId];
      if (val !== undefined) {
        formData.set("editedValue", val);
      }
    }

    submit(formData, { method: "post" });
  };

  const getScoreColor = (score: number) => {
    if (score >= 90) return { color: "#10b981", bg: "#ecfdf5" };
    if (score >= 70) return { color: "#3b82f6", bg: "#eff6ff" };
    if (score >= 50) return { color: "#f59e0b", bg: "#fffbeb" };
    return { color: "#ef4444", bg: "#fef2f2" };
  };

  const currentScoreColor = getScoreColor(details.overallScore);
  const pendingSuggestions = details.aiSuggestions.filter((s) => s.status === "PENDING");
  const processedSuggestions = details.aiSuggestions.filter((s) => s.status !== "PENDING");

  // Field types the merchant fills in by hand (we never let AI invent a SKU,
  // barcode, weight, or tag set). They render an input instead of the AI diff
  // view and always submit as an EDITED merchant value.
  const MANUAL_ENTRY_FIELDS = new Set(["VARIANT_SKU", "VARIANT_BARCODE", "VARIANT_WEIGHT", "TAGS"]);
  const FIELD_LABELS: Record<string, string> = {
    TITLE: "Title",
    DESCRIPTION: "Description",
    ALT_TEXT: "Image Alt Text",
    VARIANT_SKU: "Variant SKU",
    VARIANT_BARCODE: "Variant Barcode / GTIN",
    VARIANT_WEIGHT: "Variant Weight",
    TAGS: "Product Tags",
  };
  const WEIGHT_UNITS = ["GRAMS", "KILOGRAMS", "OUNCES", "POUNDS"];

  return (
    <s-page heading={`AI Evaluation: ${details.title}`}>
      {/* Return button */}
      <s-link href="/app/products" slot="breadcrumb-actions">
        Back to Products
      </s-link>

      {/* Action response banner */}
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
          Failed to update Shopify: {actionData.error}
        </div>
      )}

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
          Shopify catalog updated successfully.
        </div>
      )}

      {/* Main product stats */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 2fr",
          gap: "24px",
          marginBottom: "24px",
        }}
      >
        <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "12px", padding: "12px 0" }}>
            <span style={{ fontSize: "14px", fontWeight: "600", textTransform: "uppercase", color: "#6b7280" }}>
              Readiness Score
            </span>
            <div
              style={{
                fontSize: "36px",
                fontWeight: "800",
                color: currentScoreColor.color,
                backgroundColor: currentScoreColor.bg,
                width: "90px",
                height: "90px",
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "8px 0",
                opacity: isApplying ? 0.5 : 1,
                transition: "opacity 0.2s ease-in-out",
              }}
            >
              {details.overallScore}
            </div>
            <span style={{ fontSize: "12px", color: "#6b7280", textAlign: "center" }}>
              {isApplying ? "Recalculating score…" : "Product details page scan status."}
            </span>
          </div>
        </s-box>

        <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
          <s-stack direction="block" gap="base">
            <s-heading>Evaluations Breakdown</s-heading>
            {[
              { name: "Title Score", val: details.titleScore },
              { name: "Description Score", val: details.descriptionScore },
              { name: "Media Assets Score", val: details.mediaScore },
              { name: "Variants Parameters Score", val: details.variantScore },
              { name: "Structured Data Taxonomies", val: details.structuredDataScore },
            ].map((part) => (
              <div key={part.name} style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid #e5e7eb", paddingBottom: "4px" }}>
                <span style={{ fontSize: "13px" }}>{part.name}</span>
                <span style={{ fontSize: "13px", fontWeight: "700", color: getScoreColor(part.val).color }}>{part.val}%</span>
              </div>
            ))}
          </s-stack>
        </s-box>
      </div>

      {/* Identified Issues */}
      <s-section heading="Identified Catalog Issues">
        {details.issues.length === 0 ? (
          <s-box padding="base" background="subdued" borderRadius="base">
            <p style={{ color: "#10b981", fontWeight: "600", textAlign: "center", margin: 0 }}>
              Beautiful! All issues resolved on this product.
            </p>
          </s-box>
        ) : (
          <s-stack direction="block" gap="base">
            {details.issues.map((issue) => (
              <div
                key={issue.id}
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: "8px",
                  padding: "12px 16px",
                  backgroundColor: "#ffffff",
                  display: "flex",
                  flexDirection: "column",
                  gap: "4px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontWeight: "700", fontSize: "14px" }}>{issue.message}</span>
                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: "700",
                      padding: "2px 6px",
                      borderRadius: "4px",
                      backgroundColor: issue.severity === "CRITICAL" ? "#fef2f2" : "#fffbeb",
                      color: issue.severity === "CRITICAL" ? "#ef4444" : "#d97706",
                    }}
                  >
                    {issue.severity}
                  </span>
                </div>
                <span style={{ fontSize: "12.5px", color: "#4b5563" }}>{issue.details}</span>
              </div>
            ))}
          </s-stack>
        )}
      </s-section>

      {/* AI Suggestions Engine (Diff view with editing option) */}
      <s-section heading="AI Suggestions & Optimizations">
        {pendingSuggestions.length === 0 ? (
          <s-box padding="base" background="subdued" borderRadius="base">
            <p style={{ color: "#6b7280", textAlign: "center", margin: 0 }}>
              No pending suggestions. If you have active issues, wait a moment while the optimizer prepares them.
            </p>
          </s-box>
        ) : (
          <s-stack direction="block" gap="large">
            {pendingSuggestions.map((suggestion) => {
              const isManual = MANUAL_ENTRY_FIELDS.has(suggestion.fieldType);
              const fieldLabel = FIELD_LABELS[suggestion.fieldType] || suggestion.fieldType;

              // ── Manual-entry fields (SKU / barcode / weight / tags) ──────────
              if (isManual) {
                const isWeight = suggestion.fieldType === "VARIANT_WEIGHT";
                const raw = editedValues[suggestion.id] ?? (isWeight ? "::KILOGRAMS" : "");
                const [weightValue, weightUnitRaw] = raw.split("::");
                const weightUnit = weightUnitRaw || "KILOGRAMS";

                const canApply = isWeight
                  ? isFinite(parseFloat(weightValue)) && parseFloat(weightValue) > 0
                  : raw.trim().length > 0;

                const placeholder =
                  suggestion.fieldType === "VARIANT_SKU"
                    ? "e.g. TSHIRT-RED-L"
                    : suggestion.fieldType === "VARIANT_BARCODE"
                    ? "e.g. 0123456789012 (UPC/EAN/GTIN)"
                    : suggestion.fieldType === "TAGS"
                    ? "Comma-separated, e.g. cotton, unisex, summer"
                    : "";

                const contextLabel =
                  suggestion.fieldType === "TAGS"
                    ? `Current tags: ${suggestion.originalContent || "[none]"}`
                    : `Variant: ${suggestion.originalContent || "Default"}`;

                return (
                  <s-box key={suggestion.id} padding="base" borderWidth="base" borderRadius="base">
                    <s-stack direction="block" gap="base">
                      <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid #e5e7eb", paddingBottom: "8px" }}>
                        <span style={{ fontWeight: "700", textTransform: "uppercase", fontSize: "12px", color: "#3b82f6" }}>
                          Add {fieldLabel}
                        </span>
                        <span style={{ fontSize: "12px", color: "#6b7280" }}>{contextLabel}</span>
                      </div>

                      <div style={{ marginTop: "8px" }}>
                        <span style={{ fontSize: "12px", fontWeight: "600", color: "#10b981", display: "block", marginBottom: "4px" }}>
                          Enter value to apply to Shopify:
                        </span>

                        {isWeight ? (
                          <div style={{ display: "flex", gap: "8px" }}>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="0.00"
                              style={{
                                flex: 1,
                                padding: "8px",
                                border: "1.5px solid #10b981",
                                borderRadius: "4px",
                                fontSize: "13px",
                                fontFamily: "inherit",
                                boxSizing: "border-box",
                              }}
                              value={weightValue}
                              onChange={(e) =>
                                setEditedValues({ ...editedValues, [suggestion.id]: `${e.target.value}::${weightUnit}` })
                              }
                            />
                            <select
                              style={{
                                padding: "8px",
                                border: "1.5px solid #10b981",
                                borderRadius: "4px",
                                fontSize: "13px",
                                fontFamily: "inherit",
                              }}
                              value={weightUnit}
                              onChange={(e) =>
                                setEditedValues({ ...editedValues, [suggestion.id]: `${weightValue}::${e.target.value}` })
                              }
                            >
                              {WEIGHT_UNITS.map((u) => (
                                <option key={u} value={u}>
                                  {u}
                                </option>
                              ))}
                            </select>
                          </div>
                        ) : (
                          <input
                            type="text"
                            placeholder={placeholder}
                            style={{
                              width: "100%",
                              padding: "8px",
                              border: "1.5px solid #10b981",
                              borderRadius: "4px",
                              fontSize: "13px",
                              fontFamily: "inherit",
                              boxSizing: "border-box",
                            }}
                            value={raw}
                            onChange={(e) => setEditedValues({ ...editedValues, [suggestion.id]: e.target.value })}
                          />
                        )}
                      </div>

                      <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "12px" }}>
                        <s-button
                          variant="tertiary"
                          onClick={() => handleSuggestionAction(suggestion.id, "REJECTED")}
                          {...(isApplying ? { disabled: true } : {})}
                        >
                          Dismiss
                        </s-button>
                        <s-button
                          variant="primary"
                          onClick={() => handleSuggestionAction(suggestion.id, "EDITED")}
                          {...(isApplying || !canApply ? { disabled: true } : {})}
                        >
                          {isApplying ? "Applying…" : "Save & Apply"}
                        </s-button>
                      </div>
                    </s-stack>
                  </s-box>
                );
              }

              // ── AI-generated fields (title / description / alt text) ─────────
              const currentVal = editedValues[suggestion.id] !== undefined ? editedValues[suggestion.id] : suggestion.suggestedContent;
              const isEdited = currentVal !== suggestion.suggestedContent;

              return (
                <s-box key={suggestion.id} padding="base" borderWidth="base" borderRadius="base">
                  <s-stack direction="block" gap="base">
                    {/* Header */}
                    <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid #e5e7eb", paddingBottom: "8px" }}>
                      <span style={{ fontWeight: "700", textTransform: "uppercase", fontSize: "12px", color: "#3b82f6" }}>
                        Optimize Field: {fieldLabel}
                      </span>
                      <span style={{ fontSize: "12px", color: "#6b7280" }}>
                        {suggestion.fieldType === "ALT_TEXT" ? `Image ID: ${suggestion.metafieldKey?.substring(0, 15)}...` : ""}
                      </span>
                    </div>

                    {/* Diff comparison column */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginTop: "8px" }}>
                      {/* Left: Original */}
                      <div>
                        <span style={{ fontSize: "12px", fontWeight: "600", color: "#6b7280", display: "block", marginBottom: "4px" }}>
                          Original Value:
                        </span>
                        {suggestion.fieldType === "DESCRIPTION" ? (
                          <div
                            style={{
                              padding: "8px",
                              backgroundColor: "#f9fafb",
                              border: "1px solid #e5e7eb",
                              borderRadius: "4px",
                              fontSize: "13px",
                              minHeight: "80px",
                              whiteSpace: "pre-wrap",
                              wordBreak: "break-word",
                            }}
                            dangerouslySetInnerHTML={{ __html: sanitizeHtml(suggestion.originalContent || "") }}
                          />
                        ) : (
                          <div
                            style={{
                              padding: "8px",
                              backgroundColor: "#f9fafb",
                              border: "1px solid #e5e7eb",
                              borderRadius: "4px",
                              fontSize: "13px",
                              minHeight: "80px",
                              whiteSpace: "pre-wrap",
                              wordBreak: "break-word",
                            }}
                          >
                            {suggestion.originalContent || "[Empty]"}
                          </div>
                        )}
                      </div>

                      {/* Right: Suggested / Editable */}
                      <div>
                        <span style={{ fontSize: "12px", fontWeight: "600", color: "#10b981", display: "block", marginBottom: "4px" }}>
                          AI Recommendation (Editable):
                        </span>
                        <textarea
                          style={{
                            width: "100%",
                            padding: "8px",
                            border: "1.5px solid #10b981",
                            borderRadius: "4px",
                            fontSize: "13px",
                            minHeight: "80px",
                            fontFamily: "inherit",
                            boxSizing: "border-box",
                            resize: "vertical",
                          }}
                          value={currentVal}
                          onChange={(e) => setEditedValues({ ...editedValues, [suggestion.id]: e.target.value })}
                        />
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "12px" }}>
                      <s-button
                        variant="tertiary"
                        onClick={() => handleSuggestionAction(suggestion.id, "REJECTED")}
                        {...(isApplying ? { disabled: true } : {})}
                      >
                        Dismiss
                      </s-button>
                      <s-button
                        variant={isEdited ? "secondary" : "primary"}
                        onClick={() => handleSuggestionAction(suggestion.id, isEdited ? "EDITED" : "ACCEPTED")}
                        {...(isApplying ? { disabled: true } : {})}
                      >
                        {isApplying ? "Applying…" : isEdited ? "Apply Merchant Edit" : "Accept & Apply Fix"}
                      </s-button>
                    </div>
                  </s-stack>
                </s-box>
              );
            })}
          </s-stack>
        )}
      </s-section>

      {/* Applied / Resolved Log */}
      {processedSuggestions.length > 0 && (
        <s-section heading="Resolved Suggestions History">
          <div
            style={{
              border: "1.5px solid #e5e7eb",
              borderRadius: "8px",
              overflow: "hidden",
              backgroundColor: "#ffffff",
            }}
          >
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
              <thead>
                <tr style={{ backgroundColor: "#f9fafb", borderBottom: "1.5px solid #e5e7eb", fontSize: "12px", color: "#374151" }}>
                  <th style={{ padding: "10px 16px" }}>Optimized Field</th>
                  <th style={{ padding: "10px 16px" }}>Status</th>
                  <th style={{ padding: "10px 16px" }}>Applied Content</th>
                </tr>
              </thead>
              <tbody>
                {processedSuggestions.map((s) => (
                  <tr key={s.id} style={{ borderBottom: "1px solid #f3f4f6", fontSize: "12.5px" }}>
                    <td style={{ padding: "10px 16px", fontWeight: "600" }}>{s.fieldType}</td>
                    <td style={{ padding: "10px 16px" }}>
                      <span
                        style={{
                          fontSize: "11px",
                          fontWeight: "700",
                          padding: "2px 6px",
                          borderRadius: "4px",
                          backgroundColor: s.status === "ACCEPTED" || s.status === "EDITED" ? "#ecfdf5" : "#f3f4f6",
                          color: s.status === "ACCEPTED" || s.status === "EDITED" ? "#10b981" : "#6b7280",
                        }}
                      >
                        {s.status}
                      </span>
                    </td>
                    <td style={{ padding: "10px 16px", color: "#4b5563" }}>
                      <div style={{ maxWidth: "300px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {s.suggestedContent}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </s-section>
      )}
    </s-page>
  );
}

// See app.billing.tsx for why every route under /app exports its own
// ErrorBoundary/headers instead of relying solely on app.tsx's.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
