import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

// GDPR mandatory webhook: customers/redact
//
// Sent 10 days after a customer's data erasure request (or automatically if
// the customer hasn't placed an order with the shop in 6 months). The
// merchant's apps must delete any personal data they hold about that
// customer.
//
// GEO Engine never stores customer-identifiable data (no names, emails,
// addresses, or order history) - it only analyzes product catalog content.
// There is no per-customer record in our database to redact, so this is a
// no-op beyond acknowledging the webhook.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`, {
    customerId: payload?.customer?.id,
  });

  // Nothing to delete - no customer-level data is ever persisted by this app.

  return new Response();
};
