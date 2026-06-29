import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "~/db.server";

/**
 * Resource route (no component) that streams the catalog report as CSV.
 *
 * This is intentionally separate from app.products.tsx: a route WITH a
 * component made React Router treat the programmatic fetch as a data request and
 * mishandle the raw Response (500). A component-less resource route always
 * returns the loader's Response verbatim, for any request type.
 *
 * Auth: the client attaches the App Bridge session token as a Bearer header, so
 * authenticate.admin resolves the embedded session here just like any loader.
 */
const CSV_HEADER =
  "Title,Handle,Overall Score,Title Score,Description Score,Media Score,Variant Score,Structured Data Score,Open Issues";

function csvResponse(body: string): Response {
  const dateStamp = new Date().toISOString().split("T")[0];
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="catalog-report-${dateStamp}.csv"`,
    },
  });
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);

  try {
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
      return csvResponse(`${CSV_HEADER}\n`);
    }

    const allProducts = await prisma.productScan.findMany({
      // Locked (over-limit) products carry no scan data — exclude from the report.
      where: { scanId: latestScan.id, locked: false },
      include: {
        _count: { select: { issues: { where: { resolved: false } } } },
      },
      orderBy: { overallScore: "asc" },
    });

    const csvRows: string[] = [CSV_HEADER];
    for (const p of allProducts) {
      const safeTitle = `"${(p.title || "").replace(/"/g, '""')}"`;
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

    return csvResponse(csvRows.join("\n"));
  } catch (error) {
    // Surface the real reason instead of an opaque 500 so it can be diagnosed.
    console.error("[ExportCSV] Failed to build catalog report:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return new Response(`CSV export failed: ${message}`, { status: 500 });
  }
};
