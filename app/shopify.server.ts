import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  BillingInterval,
  BillingReplacementBehavior,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";

// Plan names below are what merchants see on the Shopify-hosted billing
// confirmation screen and in Shopify Admin > Settings > Billing. They are
// intentionally different from the short internal StoreProfile.plan codes
// ("FREE" | "STARTER" | "GROWTH" | "UNLIMITED") used throughout the rest of
// the app - see PLAN_NAME_TO_CODE below for the mapping back.
export const STARTER_PLAN = "GEO Engine Starter";
export const GROWTH_PLAN = "GEO Engine Growth";
export const UNLIMITED_PLAN = "GEO Engine Unlimited";

export const PLAN_NAME_TO_CODE: Record<string, "STARTER" | "GROWTH" | "UNLIMITED"> = {
  [STARTER_PLAN]: "STARTER",
  [GROWTH_PLAN]: "GROWTH",
  [UNLIMITED_PLAN]: "UNLIMITED",
};

// Never charge real money outside of production. Shopify also refuses to
// charge development/test stores regardless of this flag, but we set it
// explicitly so local/staging environments never attempt a live charge.
//
// IMPORTANT: Shopify *rejects* a live (non-test) charge on a development/test
// store, which surfaces as a 500 on the billing action. When the hosted app
// runs with NODE_ENV=production (e.g. on Render) but is installed on a dev
// store for testing, set SHOPIFY_BILLING_TEST=true to force test charges and
// avoid that rejection. Leave it unset for real production stores.
export const isTestCharge =
  process.env.SHOPIFY_BILLING_TEST === "true" || process.env.NODE_ENV !== "production";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.April26,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  future: {
    expiringOfflineAccessTokens: true,
  },
  billing: {
    [STARTER_PLAN]: {
      lineItems: [
        {
          amount: 3.99,
          currencyCode: "USD",
          interval: BillingInterval.Every30Days,
        },
      ],
      // Lets a merchant move directly between paid tiers without having to
      // cancel their current subscription first.
      replacementBehavior: BillingReplacementBehavior.ApplyImmediately,
    },
    [GROWTH_PLAN]: {
      lineItems: [
        {
          amount: 9.99,
          currencyCode: "USD",
          interval: BillingInterval.Every30Days,
        },
      ],
      replacementBehavior: BillingReplacementBehavior.ApplyImmediately,
    },
    [UNLIMITED_PLAN]: {
      lineItems: [
        {
          amount: 29.99,
          currencyCode: "USD",
          interval: BillingInterval.Every30Days,
        },
      ],
      replacementBehavior: BillingReplacementBehavior.ApplyImmediately,
    },
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.April26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
