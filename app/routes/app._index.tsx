import { useEffect } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useRouteError, useSubmit } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getStoreDashboardData } from "~/services/db/store.server";
import { scanQueue } from "~/services/worker/queue.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const data = await getStoreDashboardData(session.shop);
  return { ...data, shop: session.shop };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "scan") {
    const success = await scanQueue.enqueue(session.shop);
    return { success, message: success ? "Scan started" : "Scan already in progress" };
  }

  return { success: false, error: "Invalid intent" };
};

export default function Index() {
  const { profile, latestScan, recommendations, history, shop, showReviewBanner } = useLoaderData<typeof loader>();
  const submit = useSubmit();

  const isScanning = profile.scanStatus === "SCANNING";

  // Auto-reload the page while scanning to update progress
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isScanning) {
      timer = setInterval(() => {
        submit(null, { method: "get" });
      }, 3000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isScanning, submit]);

  const triggerScan = () => {
    const formData = new FormData();
    formData.append("intent", "scan");
    submit(formData, { method: "post" });
  };

  const getHealthLevel = (score: number) => {
    if (score >= 90) return { label: "Excellent", color: "#10b981", bg: "#ecfdf5" };
    if (score >= 70) return { label: "Good", color: "#3b82f6", bg: "#eff6ff" };
    if (score >= 50) return { label: "Needs Improvement", color: "#f59e0b", bg: "#fffbeb" };
    return { label: "Critical", color: "#ef4444", bg: "#fef2f2" };
  };

  const health = getHealthLevel(latestScan?.overallScore || 0);

  const drawChart = () => {
    if (history.length < 2) {
      return (
        <div style={{ padding: "40px 0", color: "#9ca3af", textAlign: "center" }}>
          Not enough historical scans to display trend.
        </div>
      );
    }

    const width = 500;
    const height = 150;
    const padding = 20;

    const maxX = history.length - 1;
    const maxY = 100;

    const points = history
      .map((d, index) => {
        const x = padding + (index / maxX) * (width - padding * 2);
        const y = height - padding - (d.overallScore / maxY) * (height - padding * 2);
        return `${x},${y}`;
      })
      .join(" ");

    return (
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "auto" }}>
        <line x1={padding} y1={padding} x2={width - padding} y2={padding} stroke="#f3f4f6" strokeWidth={1} />
        <line x1={padding} y1={height / 2} x2={width - padding} y2={height / 2} stroke="#f3f4f6" strokeWidth={1} />
        <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="#e5e7eb" strokeWidth={1.5} />
        <polygon
          points={`${padding},${height - padding} ${points} ${width - padding},${height - padding}`}
          fill="url(#chartGradient)"
          opacity="0.15"
        />
        <polyline fill="none" stroke="#3b82f6" strokeWidth="2.5" points={points} />
        {history.map((d, index) => {
          const x = padding + (index / maxX) * (width - padding * 2);
          const y = height - padding - (d.overallScore / maxY) * (height - padding * 2);
          return (
            <g key={d.id}>
              <circle cx={x} cy={y} r="4" fill="#3b82f6" stroke="#ffffff" strokeWidth="1.5" />
            </g>
          );
        })}
        <defs>
          <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" />
            <stop offset="100%" stopColor="#ffffff" />
          </linearGradient>
        </defs>
      </svg>
    );
  };

  return (
    <s-page heading="GEO Engine: AI Commerce Catalog Monitor">
      <s-button
        slot="primary-action"
        onClick={triggerScan}
        {...(isScanning ? { loading: true } : {})}
      >
        {isScanning ? "Scanning Catalog..." : "Scan Catalog Now"}
      </s-button>

      {showReviewBanner && (
        <div
          style={{
            padding: "16px",
            backgroundColor: "#f0fdf4",
            border: "1px solid #bbf7d0",
            borderRadius: "8px",
            marginBottom: "20px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ display: "inline-flex" }} aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="#f59e0b">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 21 12 17.77 5.82 21 7 14.14l-5-4.87 6.91-1.01L12 2z" />
              </svg>
            </span>
            <div>
              <span style={{ fontWeight: "700", color: "#166534", display: "block" }}>
                GEO Engine is helping your catalog!
              </span>
              <span style={{ fontSize: "13px", color: "#166534" }}>
                Your AI Readiness score has improved and you have successfully resolved catalog blockers. If you like the app, please leave us a review on the Shopify App Store!
              </span>
            </div>
          </div>
          <s-link target="_blank" href="https://apps.shopify.com/geo-engine">
            <s-button variant="primary">Leave a Review</s-button>
          </s-link>
        </div>
      )}

      {/* Scanning state */}
      {isScanning && (
        <s-section heading="Continuous Catalog Scanning">
          <s-box padding="large" background="subdued" borderRadius="base">
            <div style={{ display: "flex", flexDirection: "column", gap: "24px", alignItems: "center" }}>
              <div
                style={{
                  width: "50px",
                  height: "50px",
                  border: "4px solid #f3f4f6",
                  borderTop: "4px solid #3b82f6",
                  borderRadius: "50%",
                  animation: "spin 1s linear infinite",
                }}
              />
              <s-heading>Analyzing products and store metadata...</s-heading>
              <p style={{ margin: 0, textAlign: "center", color: "#4b5563" }}>
                We are currently inspecting products, images, collections, and policy schemas. This normally completes in less than 60 seconds. This page updates automatically.
              </p>
            </div>
          </s-box>
          <style dangerouslySetInnerHTML={{ __html: `
            @keyframes spin {
              0% { transform: rotate(0deg); }
              100% { transform: rotate(360deg); }
            }
          `}} />
        </s-section>
      )}

      {/* Onboarding */}
      {!isScanning && !latestScan && (
        <s-section heading="Welcome to GEO Engine">
          <s-box padding="large" background="subdued" borderRadius="base">
            <div style={{ display: "flex", flexDirection: "column", gap: "24px", alignItems: "center" }}>
              <s-heading>Is your store ready for AI Commerce?</s-heading>
              <p style={{ margin: 0, textAlign: "center", color: "#4b5563" }}>
                AI Search Engines (Google, Gemini, ChatGPT, Perplexity) rely heavily on structured catalog specifications, clear alt text, and consistent metadata attributes to verify and recommend store products. Start your first scan below to inspect your store.
              </p>
              <s-button onClick={triggerScan}>Run Initial Health Scan</s-button>
            </div>
          </s-box>
        </s-section>
      )}

      {!isScanning && latestScan && (
        <>
          {/* Critical warnings */}
          {latestScan.criticalIssuesCount > 0 && (
            <div
              style={{
                backgroundColor: "#fef2f2",
                border: "1px solid #fee2e2",
                borderRadius: "8px",
                padding: "16px",
                marginBottom: "24px",
                display: "flex",
                alignItems: "center",
                gap: "16px",
              }}
            >
              <div style={{ display: "flex", color: "#ef4444" }} aria-hidden="true">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              </div>
              <div style={{ flex: 1 }}>
                <h3 style={{ color: "#ef4444", margin: 0, fontSize: "16px", fontWeight: "700" }}>
                  Potential AI Visibility Blockers Detected
                </h3>
                <p style={{ margin: "4px 0 0 0", color: "#4b5563", fontSize: "13px" }}>
                  We found {latestScan.criticalIssuesCount} critical visibility issues that prevent AI agents from fully indexing or recommending your products. Fix them first to improve eligibility.
                </p>
              </div>
              <s-link href="/app/products">
                <s-button variant="secondary">View Affected Items</s-button>
              </s-link>
            </div>
          )}

          {/* Core score grid */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
              gap: "24px",
              marginBottom: "24px",
            }}
          >
            {/* Score Dial */}
            <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
              <div style={{ display: "flex", flexDirection: "column", gap: "12px", alignItems: "center", padding: "12px 0" }}>
                <span style={{ fontSize: "14px", fontWeight: "600", textTransform: "uppercase", color: "#6b7280" }}>
                  Store AI Readiness Score
                </span>
                <div
                  style={{
                    position: "relative",
                    width: "160px",
                    height: "160px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: "50%",
                    background: `conic-gradient(${health.color} ${latestScan.overallScore * 3.6}deg, #e5e7eb ${latestScan.overallScore * 3.6}deg)`,
                    margin: "12px 0",
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      width: "135px",
                      height: "135px",
                      borderRadius: "50%",
                      backgroundColor: "#ffffff",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <span style={{ fontSize: "40px", fontWeight: "800", color: "#111827" }}>
                      {latestScan.overallScore}
                    </span>
                    <span
                      style={{
                        fontSize: "11px",
                        fontWeight: "700",
                        padding: "2px 8px",
                        borderRadius: "12px",
                        backgroundColor: health.bg,
                        color: health.color,
                        marginTop: "4px",
                      }}
                    >
                      {health.label}
                    </span>
                  </div>
                </div>
                <p style={{ margin: 0, textAlign: "center", fontSize: "13px", color: "#4b5563" }}>
                  Scanned {latestScan.totalProducts} products.
                </p>
              </div>
            </s-box>

            {/* Category breakdown */}
            <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
              <s-stack direction="block" gap="base">
                <s-heading>Category Evaluation</s-heading>
                {[
                  { name: "Product Title Quality", score: latestScan.titleScore },
                  { name: "Descriptions Richness", score: latestScan.descriptionScore },
                  { name: "Media Assets & Alt Texts", score: latestScan.mediaScore },
                  { name: "Variant Inventory Specs", score: latestScan.variantScore },
                  { name: "Structured Data Taxonomies", score: latestScan.structuredDataScore },
                  { name: "Compliance Store Policies", score: latestScan.policyScore },
                ].map((item) => (
                  <div key={item.name} style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px" }}>
                      <span style={{ fontWeight: "500" }}>{item.name}</span>
                      <span style={{ fontWeight: "700" }}>{item.score}%</span>
                    </div>
                    <div style={{ width: "100%", height: "8px", backgroundColor: "#e5e7eb", borderRadius: "4px" }}>
                      <div
                        style={{
                          width: `${item.score}%`,
                          height: "100%",
                          backgroundColor: getHealthLevel(item.score).color,
                          borderRadius: "4px",
                          transition: "width 0.5s ease-in-out",
                        }}
                      />
                    </div>
                  </div>
                ))}
              </s-stack>
            </s-box>
          </div>

          {/* Trend + Quick Metrics */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
              gap: "24px",
              marginBottom: "24px",
            }}
          >
            <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
              <s-stack direction="block" gap="base">
                <s-heading>Readiness Score History</s-heading>
                {drawChart()}
              </s-stack>
            </s-box>

            <s-box padding="base" borderWidth="base" borderRadius="base" background="subdued">
              <s-stack direction="block" gap="base">
                <s-heading>Catalog Completions</s-heading>
                <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "8px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>Critical issues (AI Blockers):</span>
                    <span style={{ fontWeight: "700", color: "#ef4444" }}>{latestScan.criticalIssuesCount}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>Warning indicators:</span>
                    <span style={{ fontWeight: "700", color: "#f59e0b" }}>{latestScan.warningIssuesCount}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>Information guidelines:</span>
                    <span style={{ fontWeight: "700", color: "#3b82f6" }}>{latestScan.infoIssuesCount}</span>
                  </div>
                  <div style={{ borderBottom: "1.5px dashed #e5e7eb", margin: "4px 0" }} />
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontWeight: "600" }}>Store profile tier:</span>
                    <span style={{ fontWeight: "700", color: "#10b981" }}>{profile.plan}</span>
                  </div>
                </div>
              </s-stack>
            </s-box>
          </div>

          {/* ── AI COMMERCE BENCHMARK WIDGET ────────────────────────────────── */}
          <div style={{ marginBottom: "24px" }}>
            <div
              style={{
                border: "1.5px solid #e5e7eb",
                borderRadius: "12px",
                overflow: "hidden",
                backgroundColor: "#ffffff",
                boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
              }}
            >
              {/* Header */}
              <div
                style={{
                  background: "linear-gradient(135deg, #1e3a8a 0%, #2563eb 60%, #3b82f6 100%)",
                  padding: "18px 24px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <div style={{ color: "#ffffff", fontWeight: "800", fontSize: "15px", letterSpacing: "-0.01em" }}>
                    AI Commerce Benchmark
                  </div>
                  <div style={{ color: "#93c5fd", fontSize: "12px", marginTop: "3px" }}>
                    See how your store stacks up in the AI-first search era
                  </div>
                </div>
                <div
                  style={{
                    background: "rgba(255,255,255,0.15)",
                    backdropFilter: "blur(8px)",
                    borderRadius: "8px",
                    padding: "6px 14px",
                    color: "#ffffff",
                    fontSize: "11px",
                    fontWeight: "700",
                    border: "1px solid rgba(255,255,255,0.25)",
                    letterSpacing: "0.02em",
                    textTransform: "uppercase",
                  }}
                >
                  GEO Engine Insights
                </div>
              </div>

              {/* Body */}
              <div
                style={{
                  padding: "24px",
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
                  gap: "28px",
                }}
              >
                {/* Bar chart */}
                <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                  {[
                    {
                      label: "GEO Engine users (avg)",
                      score: 94,
                      color: "#10b981",
                      tag: "Target",
                      tagBg: "#ecfdf5",
                      tagColor: "#065f46",
                    },
                    {
                      label: "Your store",
                      score: latestScan.overallScore,
                      color: health.color,
                      tag: "You",
                      tagBg: health.bg,
                      tagColor: health.color,
                    },
                    {
                      label: "Unoptimized Shopify stores",
                      score: 47,
                      color: "#d1d5db",
                      tag: "Baseline",
                      tagBg: "#f3f4f6",
                      tagColor: "#6b7280",
                    },
                  ].map(({ label, score, color, tag, tagBg, tagColor }) => (
                    <div key={label}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: "8px",
                        }}
                      >
                        <span style={{ fontSize: "12px", fontWeight: "500", color: "#374151" }}>{label}</span>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span
                            style={{
                              fontSize: "10px",
                              fontWeight: "700",
                              color: tagColor,
                              background: tagBg,
                              padding: "2px 7px",
                              borderRadius: "5px",
                            }}
                          >
                            {tag}
                          </span>
                          <span style={{ fontSize: "16px", fontWeight: "900", color, minWidth: "28px", textAlign: "right" }}>
                            {Math.round(score)}
                          </span>
                        </div>
                      </div>
                      <div
                        style={{
                          width: "100%",
                          height: "14px",
                          background: "#f3f4f6",
                          borderRadius: "7px",
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            width: `${score}%`,
                            height: "100%",
                            background: color,
                            borderRadius: "7px",
                            transition: "width 0.8s cubic-bezier(0.4, 0, 0.2, 1)",
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                {/* Status cards */}
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  {/* Points to target */}
                  {latestScan.overallScore < 94 ? (
                    <div
                      style={{
                        background: "linear-gradient(135deg, #eff6ff, #dbeafe)",
                        border: "1px solid #93c5fd",
                        borderRadius: "10px",
                        padding: "16px 18px",
                        display: "flex",
                        alignItems: "center",
                        gap: "16px",
                      }}
                    >
                      <div style={{ fontSize: "36px", fontWeight: "900", color: "#1d4ed8", lineHeight: 1 }}>
                        +{94 - Math.round(latestScan.overallScore)}
                      </div>
                      <div>
                        <div style={{ fontSize: "12px", fontWeight: "700", color: "#1e40af" }}>
                          Points to GEO Engine avg
                        </div>
                        <div style={{ fontSize: "11px", color: "#60a5fa", marginTop: "3px" }}>
                          Fix the issues below to close the gap fast
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div
                      style={{
                        background: "linear-gradient(135deg, #ecfdf5, #d1fae5)",
                        border: "1px solid #6ee7b7",
                        borderRadius: "10px",
                        padding: "16px 18px",
                      }}
                    >
                      <div style={{ fontSize: "22px", fontWeight: "900", color: "#059669" }}>Top Tier!</div>
                      <div style={{ fontSize: "12px", color: "#065f46", marginTop: "6px" }}>
                        You're above the GEO Engine community average. Outstanding catalog quality!
                      </div>
                    </div>
                  )}

                  {/* vs baseline */}
                  <div
                    style={{
                      background: latestScan.overallScore > 47
                        ? "linear-gradient(135deg, #ecfdf5, #d1fae5)"
                        : "linear-gradient(135deg, #fffbeb, #fef3c7)",
                      border: `1px solid ${latestScan.overallScore > 47 ? "#6ee7b7" : "#fcd34d"}`,
                      borderRadius: "10px",
                      padding: "16px 18px",
                      display: "flex",
                      alignItems: "center",
                      gap: "14px",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "28px",
                        fontWeight: "900",
                        color: latestScan.overallScore > 47 ? "#059669" : "#d97706",
                        lineHeight: 1,
                        flexShrink: 0,
                      }}
                    >
                      {latestScan.overallScore > 47 ? "+" : ""}
                      {Math.round(latestScan.overallScore) - 47}
                    </div>
                    <div>
                      <div
                        style={{
                          fontSize: "12px",
                          fontWeight: "700",
                          color: latestScan.overallScore > 47 ? "#065f46" : "#92400e",
                        }}
                      >
                        {latestScan.overallScore > 47
                          ? "Ahead of unoptimized stores"
                          : "Below the industry baseline"}
                      </div>
                      <div style={{ fontSize: "11px", color: "#6b7280", marginTop: "3px" }}>
                        {latestScan.overallScore > 47
                          ? "AI agents are more likely to surface your products in results"
                          : "Competitors are outranking you in AI-powered search"}
                      </div>
                    </div>
                  </div>

                  {/* Footnote */}
                  <div
                    style={{
                      fontSize: "11px",
                      color: "#9ca3af",
                      lineHeight: "1.6",
                      padding: "10px 12px",
                      background: "#f9fafb",
                      borderRadius: "8px",
                      border: "1px solid #f3f4f6",
                    }}
                  >
                    Benchmarks based on GEO Engine network data. AI search engines — Google Overviews, ChatGPT Shopping, Perplexity, Gemini — favor stores with higher AI Readiness Scores for recommendations.
                  </div>
                </div>
              </div>
            </div>
          </div>
          {/* ── END BENCHMARK WIDGET ─────────────────────────────────────────── */}

          {/* Recommendations */}
          <s-section heading="Prioritized AI Recommendations">
            {recommendations.length === 0 ? (
              <s-box padding="base" background="subdued" borderRadius="base">
                <p style={{ margin: 0, textAlign: "center", color: "#10b981", fontWeight: "600" }}>
                  Excellent! No issues detected. Your store catalog is fully optimized for AI Commerce searchers.
                </p>
              </s-box>
            ) : (
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
                      <th style={{ padding: "12px 16px" }}>Priority Fix</th>
                      <th style={{ padding: "12px 16px" }}>Category</th>
                      <th style={{ padding: "12px 16px" }}>Severity</th>
                      <th style={{ padding: "12px 16px" }}>Difficulty</th>
                      <th style={{ padding: "12px 16px", textAlign: "right" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recommendations.map((rec) => (
                      <tr key={rec.type} style={{ borderBottom: "1px solid #f3f4f6", fontSize: "13px" }}>
                        <td style={{ padding: "12px 16px" }}>
                          <div>
                            <span style={{ fontWeight: "600", display: "block" }}>{rec.message}</span>
                            <span style={{ fontSize: "11.5px", color: "#6b7280" }}>{rec.details}</span>
                          </div>
                        </td>
                        <td style={{ padding: "12px 16px" }}>
                          <span style={{ fontSize: "11px", fontWeight: "600", color: "#4b5563" }}>
                            {rec.category}
                          </span>
                        </td>
                        <td style={{ padding: "12px 16px" }}>
                          <span
                            style={{
                              fontSize: "11px",
                              fontWeight: "700",
                              padding: "2px 6px",
                              borderRadius: "4px",
                              backgroundColor: rec.severity === "CRITICAL" ? "#fef2f2" : rec.severity === "WARNING" ? "#fffbeb" : "#eff6ff",
                              color: rec.severity === "CRITICAL" ? "#ef4444" : rec.severity === "WARNING" ? "#d97706" : "#3b82f6",
                            }}
                          >
                            {rec.severity}
                          </span>
                        </td>
                        <td style={{ padding: "12px 16px" }}>
                          <span style={{ fontSize: "12px" }}>{rec.difficulty}</span>
                        </td>
                        <td style={{ padding: "12px 16px", textAlign: "right" }}>
                          {rec.affectedProductScans.length > 0 ? (
                            <s-link href={`/app/products?search=${encodeURIComponent(rec.affectedProductScans[0].title)}`}>
                              <s-button variant="secondary">Inspect</s-button>
                            </s-link>
                          ) : (
                            <s-link target="_parent" href={`https://${shop}/admin/settings/legal`}>
                              <s-button variant="secondary">Resolve</s-button>
                            </s-link>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </s-section>
        </>
      )}
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
