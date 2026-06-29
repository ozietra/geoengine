import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";

// GDPR mandatory webhook: customers/data_request
//
// Shopify sends this when a customer asks a merchant for a copy of the
// personal data the merchant (and its apps) hold about them.
//
// GEO Engine never stores customer-identifiable information - it only
// analyzes shop-level catalog data (product titles, descriptions, images,
// variants) and aggregate scan history. There is no per-customer record in
// our database, so there is no personal data for this app to compile or
// return for this request.
//
// We still verify the webhook HMAC (via authenticate.webhook) and respond
// 200 so Shopify knows the request was received, and we log the request id
// for audit purposes.
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`, {
    customerId: payload?.customer?.id,
    dataRequestId: payload?.data_request?.id,
  });

  // No customer PII is stored by this app - nothing to compile or send back.

  return new Response();
};
