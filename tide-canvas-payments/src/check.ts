// Read-only account/schema check. No product creation, publication, or payment.
import { WaffoPancake } from "@waffo/pancake-ts";
import { readConfig } from "./config.js";
import { createProvider } from "./waffo.js";
const config = readConfig();
if (!config.ready) throw new Error("Supply the test private key and existing product ID in the ignored .env file first");
const client = new WaffoPancake({ merchantId: config.merchantId, privateKey: config.privateKey,
  environment: config.mode, fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(12_000), redirect: "error" }),
});
try {
  const result = await client.graphql.query<{ store: { id: string }; onetimeProduct: { id: string; status: string; store: { id: string } } }>({
    query: `query($storeId: String!, $productId: String!) {
      store(id: $storeId) { id }
      onetimeProduct(id: $productId) { id status store { id } }
    }`, variables: { storeId: config.storeId, productId: config.productId },
  });
  if (result.errors?.length || result.data?.store?.id !== config.storeId || result.data.onetimeProduct?.store.id !== config.storeId || result.data.onetimeProduct.status !== "active") throw new Error("store or one-time product unavailable");
  // An intentionally absent reference validates the full financial GraphQL
  // selection without retrieving or printing anyone's payment history.
  await createProvider(config).orders(`framelyn-${config.mode}-0`);
  console.log(`Read-only access and settlement schema checks passed (${config.mode}). Verify the API key's issued environment in the dashboard before a test payment.`);
} catch {
  console.error("Waffo account/schema check failed. Confirm key environment, merchant, store and one-time product in the dashboard. No payment was created.");
  process.exitCode = 1;
}
