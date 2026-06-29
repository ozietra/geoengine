import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { generateLlmsTxt } from "~/features/agentic/llms.server";

// ─────────────────────────────────────────────────────────────────────────
// Public App Proxy endpoint: serves the store's llms.txt
//
// Configured via [app_proxy] in shopify.app.toml (prefix "apps", subpath
// "geo"), so this is reachable on the merchant's own storefront domain at:
//
//     https://{store-domain}/apps/geo/llms.txt
//
// AI agents and LLM crawlers fetch that URL to understand the catalog. The
// request is verified by Shopify's app proxy signature via
// authenticate.public.appProxy.
// ─────────────────────────────────────────────────────────────────────────
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.public.appProxy(request);

  if (!session?.shop) {
    return new Response("# llms.txt unavailable\n\nThis store has not finished setting up GEO Engine.\n", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  try {
    const { content } = await generateLlmsTxt(session.shop);
    return new Response(content, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        // Cache at the edge/browser for an hour so high crawler traffic does
        // not regenerate the catalog on every hit.
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      },
    });
  } catch (error) {
    console.error("[llms.txt proxy] generation failed:", error);
    return new Response("# llms.txt temporarily unavailable\n", {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
};
