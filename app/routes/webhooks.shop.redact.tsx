import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

// GDPR mandatory webhook: shop/redact
//
// Sent 48 hours after a shop uninstalls the app. We must delete all data we
// hold for that shop.
//
// Deleting the StoreProfile cascades (onDelete: Cascade in schema.prisma) to
// every Scan, ProductScan, ScanIssue, AISuggestion, ScanHistory, Competitor
// and CompetitorScan row for this shop. We also clear any leftover Session
// rows as a safety net in case the app/uninstalled webhook never fired.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  await db.storeProfile.deleteMany({ where: { shop } });
  await db.session.deleteMany({ where: { shop } });

  return new Response();
};
