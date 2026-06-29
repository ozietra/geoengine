import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useRouteError, useSubmit } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getProductScans } from "~/services/db/store.server";
import prisma from "~/db.server";

/**
 * Loader handles two modes:
 *
 * 1. Normal page load (no ?format param) — returns JSON for the React
 *    component to render.
 *
 * 2. CSV export (?format=csv) — returns a downloadable CSV file with all
 *    product scan results from the latest scan.  Triggered via
 *    window.top?.location.href so the download fires in the top-level frame
 *    rather than inside Shopify's embedded app iframe.
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);

  // ── CSV export branch ──────────────────────────────────────────────────────
  if (url.searchParams.get("format") === "csv") {
    const profile = await prisma.storeProfile.findUnique({
      where: { shop: session.shop },
    });

    const latestScan = profile
      ? await prisma.scan.findFirst({
          where: { storeId: profile.id },
          orderBy: { scannedAt: "desc" },
        })
      : null;

    if (!latestScan) {
      // Return an empty CSV rather than a 404 so the browser still downloads
      // a file (just with headers only) instead of showing an error page.
      const empty = "Title,Handle,Overall Score,Title Score,Description Score,Media Score,Variant Score,Structured Data Score,Open Issues\n";
      return new Response(empty, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="catalog-report-${new Date().toISOString().split("T")[0]}.csv"`,
        },
      });
    }

    const allProducts = await prisma.productScan.findMany({
      // Locked (over-limit) products carry no scan data — exclude from the report.
      where: { scanId: latestScan.id, locked: false },
      include: {
        _count: { select: { issues: { where: { resolved: false } } } },
      },
      orderBy: { overallScore: "asc" },
    });

    const csvRows: string[] = [
      "Title,Handle,Overall Score,Title Score,Description Score,Media Score,Variant Score,Structured Data Score,Open Issues",
    ];

    for (const p of allProducts) {
      // Wrap title in quotes and escape any embedded quotes
      const safeTitle = `"${p.title.replace(/"/g, '""')}"`;
      csvRows.push(
        [
          safeTitle,
          p.handle,
          p.overallScore,
          p.titleScore,
          p.descriptionScore,
          p.mediaScore,
          p.variantScore,
          p.structuredDataScore,
          p._count.issues,
        ].join(",")
      );
    }

    const csv = csvRows.join("\n");
    const dateStamp = new Date().toISOString().split("T")[0];

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="catalog-report-${dateStamp}.csv"`,
      },
    });
  }

  // ── Normal page load ───────────────────────────────────────────────────────
  const search = url.searchParams.get("search") || "";
  const page = parseInt(url.searchParams.get("page") || "1", 10);

  const data = await getProductScans(session.shop, { page, search });
  return { ...data, search, page };
};

export default function ProductsList() {
  const { products, totalCount, totalPages, search, page, plan, scannedCount, lockedTotal } =
    useLoaderData<typeof loader>();
  const submit = useSubmit();

  const handleSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    formData.set("page", "1");
    submit(formData, { method: "get" });
  };

  const handlePageChange = (newPage: number) => {
    const formData = new FormData();
    formData.set("search", search);
    formData.set("page", newPage.toString());
    submit(formData, { method: "get" });
  };

  /**
   * Trigger a CSV download.
   *
   * In a Shopify embedded app the component runs inside an iframe.  A regular
   * fetch() or React Router submission would stay inside that iframe and the
   * browser would never show a Save-As dialog.  We instead navigate the *top*
   * frame to the ?format=csv URL; Shopify's frame wrapper ignores plain file
   * downloads and the browser handles it natively.
   */
  const handleExportCSV = () => {
    const exportUrl = `/app/products?format=csv`;
    if (window.top) {
      window.top.location.href = exportUrl;
    } else {
      window.location.href = exportUrl;
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 90) return { color: "#10b981", bg: "#ecfdf5" };
    if (score >= 70) return { color: "#3b82f6", bg: "#eff6ff" };
    if (score >= 50) return { color: "#f59e0b", bg: "#fffbeb" };
    return { color: "#ef4444", bg: "#fef2f2" };
  };

  return (
    <s-page heading="Catalog AI Readiness Directory">
      {lockedTotal > 0 && (
        <div
          style={{
            padding: "12px 16px",
            backgroundColor: "#fffbeb",
            border: "1px solid #fcd34d",
            borderRadius: "8px",
            marginBottom: "16px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: "12px",
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: "13px", color: "#92400e" }}>
            🔒 Your <strong>{plan}</strong> plan scans {scannedCount} product(s).{" "}
            <strong>{lockedTotal}</strong> more product(s) are locked. Upgrade to scan and optimize your
            full catalog.
          </span>
          <s-link href="/app/billing">
            <s-button variant="primary">Upgrade plan</s-button>
          </s-link>
        </div>
      )}

      <s-section heading="Search Products">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "16px" }}>
          <form
            onSubmit={handleSearch}
            style={{ display: "flex", gap: "12px", flex: 1, marginBottom: "16px" }}
          >
            <div style={{ flex: 1 }}>
              <s-text-field
                name="search"
                label="Product Title"
                value={search}
                placeholder="Search by product name..."
              ></s-text-field>
            </div>
            <s-button type="submit">Filter</s-button>
          </form>

          {/* Export CSV button — appears alongside the search bar */}
          <div style={{ marginBottom: "16px", flexShrink: 0 }}>
            <s-button variant="secondary" onClick={handleExportCSV}>
              Export CSV
            </s-button>
          </div>
        </div>
      </s-section>

      <s-section heading={`All Scanned Products (${totalCount})`}>
        {products.length === 0 ? (
          <s-box padding="large" background="subdued" borderRadius="base">
            <p style={{ textAlign: "center", color: "#6b7280", margin: 0 }}>
              No scanned products found. Run a catalog scan on the homepage first, or try adjusting your search terms.
            </p>
          </s-box>
        ) : (
          <>
            <div
              style={{
                border: "1.5px solid #e5e7eb",
                borderRadius: "8px",
                overflow: "hidden",
                backgroundColor: "#ffffff",
                marginBottom: "16px",
              }}
            >
              <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
                <thead>
                  <tr style={{ backgroundColor: "#f9fafb", borderBottom: "1.5px solid #e5e7eb", fontSize: "12px", color: "#374151" }}>
                    <th style={{ padding: "12px 16px" }}>Product Name</th>
                    <th style={{ padding: "12px 16px" }}>AI Readiness Score</th>
                    <th style={{ padding: "12px 16px" }}>Identified Issues</th>
                    <th style={{ padding: "12px 16px", textAlign: "right" }}>Inspect</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((product) => {
                    // Locked (over-limit) products: shown greyed out as an upgrade
                    // prompt, with no score, issues, or inspect link.
                    if (product.locked) {
                      return (
                        <tr key={product.id} style={{ borderBottom: "1px solid #f3f4f6", fontSize: "13px", backgroundColor: "#fafafa" }}>
                          <td style={{ padding: "12px 16px", fontWeight: "600", color: "#9ca3af" }}>
                            🔒 {product.title}
                          </td>
                          <td style={{ padding: "12px 16px" }}>
                            <span
                              style={{
                                fontSize: "12px",
                                fontWeight: "700",
                                padding: "4px 10px",
                                borderRadius: "12px",
                                backgroundColor: "#f3f4f6",
                                color: "#9ca3af",
                              }}
                            >
                              Locked
                            </span>
                          </td>
                          <td style={{ padding: "12px 16px", color: "#9ca3af" }}>Upgrade to scan</td>
                          <td style={{ padding: "12px 16px", textAlign: "right" }}>
                            <s-link href="/app/billing">
                              <s-button variant="secondary">Upgrade</s-button>
                            </s-link>
                          </td>
                        </tr>
                      );
                    }

                    const status = getScoreColor(product.overallScore);
                    const issuesCount = product._count.issues;
                    return (
                      <tr key={product.id} style={{ borderBottom: "1px solid #f3f4f6", fontSize: "13px" }}>
                        <td style={{ padding: "12px 16px", fontWeight: "600" }}>{product.title}</td>
                        <td style={{ padding: "12px 16px" }}>
                          <span
                            style={{
                              fontSize: "12px",
                              fontWeight: "800",
                              padding: "4px 10px",
                              borderRadius: "12px",
                              backgroundColor: status.bg,
                              color: status.color,
                            }}
                          >
                            {product.overallScore} / 100
                          </span>
                        </td>
                        <td style={{ padding: "12px 16px" }}>
                          {issuesCount > 0 ? (
                            <span style={{ color: "#ef4444", fontWeight: "600" }}>
                              {issuesCount} unresolved issue(s)
                            </span>
                          ) : (
                            <span style={{ color: "#10b981", fontWeight: "600" }}>Optimized</span>
                          )}
                        </td>
                        <td style={{ padding: "12px 16px", textAlign: "right" }}>
                          <s-link href={`/app/product/${product.id}`}>
                            <s-button variant="secondary">Review Suggestions</s-button>
                          </s-link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div style={{ display: "flex", justifyContent: "center", gap: "8px", marginTop: "16px" }}>
                <s-button
                  onClick={() => handlePageChange(page - 1)}
                  {...(page <= 1 ? { disabled: true } : {})}
                >
                  Previous
                </s-button>
                <div style={{ display: "flex", alignItems: "center", padding: "0 12px", fontSize: "13px" }}>
                  Page {page} of {totalPages}
                </div>
                <s-button
                  onClick={() => handlePageChange(page + 1)}
                  {...(page >= totalPages ? { disabled: true } : {})}
                >
                  Next
                </s-button>
              </div>
            )}
          </>
        )}
      </s-section>
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
