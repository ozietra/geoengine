import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useRouteError, useSubmit } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import {
  authenticate,
  STARTER_PLAN,
  GROWTH_PLAN,
  UNLIMITED_PLAN,
  PLAN_NAME_TO_CODE,
  isTestCharge,
} from "../shopify.server";
import prisma from "~/db.server";

const PLAN_NAME_BY_CODE = {
  STARTER: STARTER_PLAN,
  GROWTH: GROWTH_PLAN,
  UNLIMITED: UNLIMITED_PLAN,
} as const;

const PLAN_RANK: Record<string, number> = {
  FREE: 0,
  STARTER: 1,
  GROWTH: 2,
  UNLIMITED: 3,
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);

  const { hasActivePayment, appSubscriptions } = await billing.check({
    isTest: isTestCharge,
  });

  const activeSubscription = hasActivePayment ? appSubscriptions[0] : undefined;
  const planCode = activeSubscription
    ? PLAN_NAME_TO_CODE[activeSubscription.name] ?? "FREE"
    : "FREE";

  const profile = await prisma.storeProfile.upsert({
    where: { shop: session.shop },
    update: { plan: planCode },
    create: { shop: session.shop, plan: planCode },
  });

  return { profile };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, billing } = await authenticate.admin(request);
  const formData = await request.formData();
  const plan = formData.get("plan") as string;

  if (!plan) {
    return { success: false, error: "Plan parameter is missing" };
  }

  const VALID_PLANS = ["FREE", "STARTER", "GROWTH", "UNLIMITED"] as const;
  if (!VALID_PLANS.includes(plan as typeof VALID_PLANS[number])) {
    return { success: false, error: "Invalid plan selected" };
  }

  if (plan === "FREE") {
    const { appSubscriptions } = await billing.check({ isTest: isTestCharge });

    for (const subscription of appSubscriptions) {
      await billing.cancel({
        subscriptionId: subscription.id,
        isTest: isTestCharge,
        prorate: true,
      });
    }

    const updatedProfile = await prisma.storeProfile.update({
      where: { shop: session.shop },
      data: { plan: "FREE" },
    });

    return { success: true, plan: updatedProfile.plan };
  }

  const paidPlanCode = plan as "STARTER" | "GROWTH" | "UNLIMITED";

  return billing.request({
    plan: PLAN_NAME_BY_CODE[paidPlanCode],
    isTest: isTestCharge,
    returnUrl: `${process.env.SHOPIFY_APP_URL}/app/billing`,
  });
};

export default function BillingPage() {
  const { profile } = useLoaderData<typeof loader>();
  const submit = useSubmit();

  const currentPlanCode = profile?.plan || "FREE";

  const handlePlanSelect = (selectedPlan: string) => {
    const formData = new FormData();
    formData.set("plan", selectedPlan);
    submit(formData, { method: "post" });
  };

  const plans = [
    {
      name: "FREE",
      price: "$0.00",
      limit: "Up to 5 products",
      features: [
        "Core Readiness evaluation",
        "Deterministic local recommendations",
        "Manual catalog scan",
        "Alt text coverage report",
      ],
      color: "#6b7280",
      highlight: false,
    },
    {
      name: "STARTER",
      price: "$3.99",
      limit: "Up to 100 products",
      features: [
        "Everything in Free",
        "Full AI Suggestion Pipeline",
        "Weekly automated catalog monitoring",
        "Prioritized ROI action lists",
        "1-click Shopify catalog writeback",
      ],
      color: "#3b82f6",
      highlight: false,
    },
    {
      name: "GROWTH",
      price: "$9.99",
      limit: "Up to 1,000 products",
      features: [
        "Everything in Starter",
        "Bulk AI Suggestion review & apply",
        "Monthly catalog health reports",
        "Historical regression alarms",
        "Priority worker processing slots",
      ],
      color: "#8b5cf6",
      highlight: true,
    },
    {
      name: "UNLIMITED",
      price: "$29.99",
      limit: "Unlimited products",
      features: [
        "Everything in Growth",
        "Dedicated API throughput",
        "Direct webhook schema monitors",
        "24/7 Priority support",
      ],
      color: "#10b981",
      highlight: false,
    },
  ];

  return (
    <s-page heading="Billing & Subscriptions">
      {/* Current plan */}
      <s-section heading="Current Plan Status">
        <s-box padding="base" background="subdued" borderRadius="base">
          <div style={{ display: "flex", gap: "8px", alignItems: "center", fontSize: "14px" }}>
            <span>Your store is currently on the </span>
            <span
              style={{
                fontWeight: "800",
                fontSize: "13px",
                padding: "4px 10px",
                borderRadius: "12px",
                backgroundColor: "#eff6ff",
                color: "#2563eb",
              }}
            >
              {currentPlanCode} Plan
            </span>
            <span> ({profile?.productIdCount || 0} products scanned)</span>
          </div>
        </s-box>
      </s-section>

      {/* ── THE GEO ENGINE EFFECT ─────────────────────────────────────────── */}
      <s-section heading="The GEO Engine Effect">
        {/* Stat cards */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: "14px",
            marginBottom: "20px",
          }}
        >
          {[
            {
              value: "94",
              label: "GEO Engine users avg score",
              sub: "Starter plan and above",
              color: "#059669",
              bg: "linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)",
              border: "#6ee7b7",
            },
            {
              value: "47",
              label: "Unoptimized Shopify store avg",
              sub: "Industry baseline without AI tools",
              color: "#dc2626",
              bg: "linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)",
              border: "#fca5a5",
            },
            {
              value: "+47pts",
              label: "Average score improvement",
              sub: "After 30 days with GEO Engine",
              color: "#1d4ed8",
              bg: "linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)",
              border: "#93c5fd",
            },
            {
              value: "3×",
              label: "Higher AI search visibility",
              sub: "vs. stores scoring below 50",
              color: "#7c3aed",
              bg: "linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%)",
              border: "#c4b5fd",
            },
          ].map(({ value, label, sub, color, bg, border }) => (
            <div
              key={label}
              style={{
                background: bg,
                border: `1.5px solid ${border}`,
                borderRadius: "12px",
                padding: "20px 16px",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  fontSize: "38px",
                  fontWeight: "900",
                  color,
                  lineHeight: 1,
                  marginBottom: "10px",
                  letterSpacing: "-0.02em",
                }}
              >
                {value}
              </div>
              <div style={{ fontSize: "12px", fontWeight: "700", color: "#374151", marginBottom: "5px" }}>
                {label}
              </div>
              <div style={{ fontSize: "10px", color: "#9ca3af" }}>{sub}</div>
            </div>
          ))}
        </div>

        {/* Context note */}
        <div
          style={{
            background: "#f8fafc",
            border: "1px solid #e2e8f0",
            borderRadius: "10px",
            padding: "16px 20px",
            fontSize: "13px",
            color: "#475569",
            lineHeight: "1.7",
          }}
        >
<strong>Why this matters right now:</strong> AI-powered search engines — Google AI Overviews, ChatGPT Shopping, Perplexity, and Gemini — now drive a rapidly growing share of e-commerce discovery.
          Stores with high AI Readiness Scores are significantly more likely to appear in AI-generated product recommendations, comparison results, and zero-click answers.
          Upgrading to <strong>Starter</strong> unlocks weekly automated monitoring and AI-powered catalog suggestions — the two features responsible for the biggest score jumps in our network.
        </div>
      </s-section>
      {/* ── END GEO ENGINE EFFECT ─────────────────────────────────────────── */}

      {/* Pricing plans */}
      <s-section heading="Available Packages">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: "20px",
            marginTop: "16px",
          }}
        >
          {plans.map((plan) => {
            const isCurrent = currentPlanCode === plan.name;
            const isDowngrade = PLAN_RANK[plan.name] < PLAN_RANK[currentPlanCode];
            return (
              <div
                key={plan.name}
                style={{
                  border: isCurrent
                    ? `2.5px solid ${plan.color}`
                    : plan.highlight
                    ? `1.5px solid ${plan.color}`
                    : "1.5px solid #e5e7eb",
                  borderRadius: "10px",
                  padding: "24px 18px",
                  backgroundColor: "#ffffff",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "space-between",
                  boxShadow: isCurrent
                    ? "0 4px 12px -2px rgba(0,0,0,0.12)"
                    : plan.highlight
                    ? "0 2px 8px -2px rgba(0,0,0,0.08)"
                    : "none",
                  transform: isCurrent ? "scale(1.02)" : "scale(1)",
                  transition: "all 0.2s ease-in-out",
                  position: "relative",
                }}
              >
                {/* Most Popular badge */}
                {plan.highlight && !isCurrent && (
                  <div
                    style={{
                      position: "absolute",
                      top: "-12px",
                      left: "50%",
                      transform: "translateX(-50%)",
                      background: plan.color,
                      color: "#ffffff",
                      fontSize: "10px",
                      fontWeight: "800",
                      padding: "3px 12px",
                      borderRadius: "20px",
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Most Popular
                  </div>
                )}

                <div>
                  <span
                    style={{
                      fontSize: "13px",
                      fontWeight: "800",
                      color: plan.color,
                      textTransform: "uppercase",
                      display: "block",
                      marginBottom: "10px",
                      letterSpacing: "0.04em",
                    }}
                  >
                    {plan.name}
                  </span>

                  <div style={{ display: "flex", alignItems: "baseline", marginBottom: "6px" }}>
                    <span style={{ fontSize: "30px", fontWeight: "900", color: "#111827", letterSpacing: "-0.02em" }}>
                      {plan.price}
                    </span>
                    <span style={{ fontSize: "12px", color: "#9ca3af", marginLeft: "4px" }}>/month</span>
                  </div>

                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: "600",
                      color: "#6b7280",
                      marginBottom: "18px",
                      background: "#f9fafb",
                      padding: "3px 8px",
                      borderRadius: "5px",
                      display: "inline-block",
                    }}
                  >
                    {plan.limit}
                  </span>

                  <div style={{ borderBottom: "1px solid #f3f4f6", marginBottom: "16px", marginTop: "8px" }} />

                  <ul style={{ paddingLeft: "0", fontSize: "12.5px", color: "#4b5563", margin: 0, listStyle: "none" }}>
                    {plan.features.map((feat) => (
                      <li
                        key={feat}
                        style={{
                          marginBottom: "9px",
                          display: "flex",
                          alignItems: "flex-start",
                          gap: "8px",
                        }}
                      >
                        <span style={{ color: plan.color, fontWeight: "900", flexShrink: 0, marginTop: "1px" }}>✓</span>
                        <span>{feat}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div style={{ marginTop: "22px" }}>
                  <s-button
                    onClick={() => handlePlanSelect(plan.name)}
                    variant={plan.highlight && !isCurrent ? "primary" : "secondary"}
                    {...(isCurrent ? { disabled: true } : {})}
                  >
                    {isCurrent ? "✓ Current Plan" : isDowngrade ? "Downgrade" : "Upgrade →"}
                  </s-button>
                </div>
              </div>
            );
          })}
        </div>
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
