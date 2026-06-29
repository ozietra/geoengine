/**
 * Competitor Scanner
 * ──────────────────
 * Uses Shopify's public /products.json endpoint (available on every storefront
 * by default) to derive AI-readiness scores for competitor stores — no auth needed.
 */

import prisma from "~/db.server";

// ─── Public Shopify Storefront types ──────────────────────────────────────────

interface PublicProduct {
  id: number;
  title: string;
  body_html: string;
  product_type: string;
  tags: string;
  images: Array<{ alt: string | null }>;
  variants: Array<{ sku: string | null; barcode: string | null; weight: number }>;
}

// ─── Exported result type ──────────────────────────────────────────────────────

export interface CompetitorAnalysis {
  domain: string;
  name: string;
  overallScore: number;
  completeness: number;
  mediaScore: number;
  structuredScore: number;
  productCount: number;
}

// ─── Utilities ─────────────────────────────────────────────────────────────────

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12_000);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: "application/json", "User-Agent": "GEOEngineBot/1.0" },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function normalizeDomain(raw: string): string {
  return raw.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").trim().toLowerCase();
}

function toName(domain: string): string {
  const part = domain.replace(/^www\./i, "").split(".")[0];
  return part.charAt(0).toUpperCase() + part.slice(1);
}

const clamp = (n: number) => Math.min(100, Math.max(0, Math.round(n)));

// ─── Core analysis ─────────────────────────────────────────────────────────────

export async function analyzeCompetitorDomain(raw: string): Promise<CompetitorAnalysis | null> {
  const domain = normalizeDomain(raw);
  const data = await fetchJson<{ products: PublicProduct[] }>(
    `https://${domain}/products.json?limit=50`,
  );
  if (!data?.products?.length) return null;

  const products = data.products;
  const n = products.length;

  const avgTitleLen =
    products.reduce((s, p) => s + (p.title?.length ?? 0), 0) / n;
  const avgDescLen =
    products.reduce((s, p) => s + (p.body_html ?? "").replace(/<[^>]+>/g, "").length, 0) / n;

  const allImages = products.flatMap((p) => p.images ?? []);
  const altCov =
    allImages.length > 0
      ? allImages.filter((i) => (i.alt?.trim().length ?? 0) >= 3).length / allImages.length
      : 0;

  const allVars = products.flatMap((p) => p.variants ?? []);
  const skuCov  = allVars.length > 0 ? allVars.filter((v) => v.sku?.trim()).length / allVars.length : 0;
  const barcCov = allVars.length > 0 ? allVars.filter((v) => v.barcode?.trim()).length / allVars.length : 0;
  const wgtCov  = allVars.length > 0 ? allVars.filter((v) => (v.weight ?? 0) > 0).length / allVars.length : 0;
  const typeCov = products.filter((p) => p.product_type?.trim().length > 0).length / n;
  const tagCov  = products.filter((p) => p.tags?.trim().length > 0).length / n;

  const titleScore  = avgTitleLen >= 50 ? 100 : avgTitleLen >= 35 ? 80 : avgTitleLen >= 20 ? 55 : 25;
  const descScore   = avgDescLen >= 400 ? 100 : avgDescLen >= 200 ? 80 : avgDescLen >= 80 ? 50 : 15;
  const mediaScore  = clamp(altCov * 100);
  const completeness    = clamp(titleScore * 0.30 + descScore * 0.35 + skuCov * 100 * 0.20 + typeCov * 100 * 0.10 + tagCov * 100 * 0.05);
  const structuredScore = clamp(altCov * 100 * 0.25 + barcCov * 100 * 0.30 + wgtCov * 100 * 0.20 + typeCov * 100 * 0.15 + tagCov * 100 * 0.10);
  const overallScore    = clamp(titleScore * 0.15 + descScore * 0.20 + mediaScore * 0.20 + structuredScore * 0.25 + completeness * 0.20);

  return { domain, name: toName(domain), overallScore, completeness, mediaScore, structuredScore, productCount: n };
}

// ─── Database helpers ──────────────────────────────────────────────────────────

export async function addAndScanCompetitor(storeId: string, raw: string) {
  const domain = normalizeDomain(raw);
  let comp = await prisma.competitor.findFirst({ where: { storeId, domain } });
  if (!comp) comp = await prisma.competitor.create({ data: { storeId, domain, name: toName(domain) } });

  const analysis = await analyzeCompetitorDomain(domain);
  if (!analysis) {
    return {
      competitor: comp, analysis: null,
      error: "Could not reach this domain. Confirm it is a live Shopify store with a public product catalog.",
    };
  }

  await prisma.competitor.update({ where: { id: comp.id }, data: { name: analysis.name } });
  await prisma.competitorScan.create({
    data: {
      competitorId: comp.id,
      overallScore: analysis.overallScore,
      completeness: analysis.completeness,
      mediaScore: analysis.mediaScore,
      structuredScore: analysis.structuredScore,
    },
  });
  return { competitor: comp, analysis, error: null };
}

export async function rescanCompetitor(competitorId: string) {
  const comp = await prisma.competitor.findUnique({ where: { id: competitorId } });
  if (!comp) return { analysis: null, error: "Competitor not found." };
  const analysis = await analyzeCompetitorDomain(comp.domain);
  if (!analysis) return { analysis: null, error: "Could not reach domain. The store may be offline." };
  await prisma.competitor.update({ where: { id: competitorId }, data: { name: analysis.name } });
  await prisma.competitorScan.create({
    data: {
      competitorId,
      overallScore: analysis.overallScore,
      completeness: analysis.completeness,
      mediaScore: analysis.mediaScore,
      structuredScore: analysis.structuredScore,
    },
  });
  return { analysis, error: null };
}

export async function getCompetitorsWithLatestScan(storeId: string) {
  return prisma.competitor.findMany({
    where: { storeId },
    include: { scans: { orderBy: { scannedAt: "desc" }, take: 1 } },
    orderBy: { addedAt: "asc" },
  });
}

export async function removeCompetitor(id: string) {
  return prisma.competitor.delete({ where: { id } });
}
