import { WaffoPancake, TaxCategory, verifyWebhook } from "@waffo/pancake-ts";
import type { Config } from "./config.js";

// Keep every amount in display units on the SDK wire. BigInt is used only for
// validating sums locally, never for converting the API contract to cents.
export function cents(value: unknown): bigint {
  if (typeof value !== "string" || !/^\d{1,8}(?:\.\d{1,2})?$/.test(value)) throw new Error("Invalid provider amount");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}
const display = (value: bigint) => `${value / 100n}.${String(value % 100n).padStart(2, "0")}`;
export type CheckoutInput = {
  mode: string; orderId: string; reference: string; buyerId: string; email?: string;
  amount: string; nonce: string; expiresAt: string; productId: string; storeId: string;
};
type Amount = { currency: string; subtotal: string; taxAmount: string; total: string };
type ProviderOrder = {
  id: string; status: string; currency: string; testMode: boolean; orderMerchantExternalId: string;
  metadata: Record<string, string>; store: { id: string }; onetimeProduct: { id: string };
  priceSnapshot: Amount;
  payments: { id: string; status: string; refundStatus: string | null; snapshotAmountDetails: Amount;
    refunds: { id: string; status: string; pspAmountDetails: { currency: string; amount: string } | null }[] }[];
};
export const ORDER_FIELDS = `id status currency testMode orderMerchantExternalId metadata
  store { id } onetimeProduct { id } priceSnapshot { currency subtotal taxAmount total }
  payments { id status refundStatus snapshotAmountDetails { currency subtotal taxAmount total }
    refunds { id status pspAmountDetails { currency amount } } }`;

export function normalizeOrder(order: ProviderOrder, config: Pick<Config, "mode" | "storeId">) {
  if (!order || order.store?.id !== config.storeId || order.testMode !== (config.mode === "test") || order.currency !== "USD" || order.priceSnapshot?.currency !== "USD") throw new Error("Provider scope mismatch");
  const snapshot = order.priceSnapshot;
  if (cents(snapshot.subtotal) + cents(snapshot.taxAmount) !== cents(snapshot.total)) throw new Error("Invalid price breakdown");
  const successful = order.payments.filter(p => p.status === "succeeded");
  if (successful.length > 1) throw new Error("Multiple successful payments require review");
  const payment = successful[0];
  let refund = 0n;
  if (payment) {
    const paid = payment.snapshotAmountDetails;
    if (paid.currency !== "USD" || cents(paid.total) !== cents(snapshot.total) || cents(paid.subtotal) !== cents(snapshot.subtotal)) throw new Error("Payment amount mismatch");
    const seen = new Set<string>();
    for (const item of payment.refunds) {
      if (item.status !== "succeeded" || seen.has(item.id)) continue;
      seen.add(item.id);
      if (item.pspAmountDetails?.currency !== "USD") throw new Error("Refund amount is not confirmed");
      refund += cents(item.pspAmountDetails.amount);
    }
    if (refund > cents(snapshot.total)) throw new Error("Refund exceeds payment");
    if (payment.refundStatus && !["none", "not_refunded", "pending", "failed"].includes(payment.refundStatus) && refund === 0n) throw new Error("Refund details are incomplete");
  }
  if (order.status === "completed" && !payment) throw new Error("Completed order has no confirmed payment");
  return {
    providerId: order.id, reference: order.orderMerchantExternalId, storeId: order.store.id,
    productId: order.onetimeProduct.id, mode: config.mode, currency: "USD", metadata: order.metadata,
    subtotal: snapshot.subtotal, total: snapshot.total, tax: snapshot.taxAmount, refunded: display(refund),
    paid: order.status === "completed" && Boolean(payment), paymentId: payment?.id || "",
    refundIds: payment?.refunds.filter(r => r.status === "succeeded").map(r => r.id) || [],
    processing: order.status === "pending", canceled: order.status === "canceled",
  };
}

export function createProvider(config: Config, customFetch: typeof fetch = fetch) {
  const client = config.ready ? new WaffoPancake({ merchantId: config.merchantId, privateKey: config.privateKey,
    environment: config.mode,
    fetch: (input, init) => customFetch(input, { ...init, signal: AbortSignal.timeout(12_000), redirect: "error" }),
  }) : null;
  const required = () => { if (!client) throw new Error("Waffo is not configured"); return client; };
  async function query<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const result = await required().graphql.query<T>({ query, variables });
    if (result.errors?.length || !result.data) throw new Error("Provider lookup failed");
    return result.data;
  }
  return {
    async checkout(input: CheckoutInput) {
      if (input.mode !== config.mode || input.storeId !== config.storeId || input.productId !== config.productId ||
          !/^\d{1,20}$/.test(input.orderId) || !/^\d{1,20}$/.test(input.buyerId) ||
          input.reference !== `framelyn-${config.mode}-${input.orderId}` || !/^[a-f0-9]{64}$/.test(input.nonce) || cents(input.amount) < 50n) throw new Error("Invalid checkout request");
      // This lookup prevents a mistakenly configured subscription or another
      // store's product from turning a credit purchase into recurring billing.
      const result = await query<{ onetimeProduct: { id: string; status: string; store: { id: string } } }>(
        `query($id: String!) { onetimeProduct(id: $id) { id status store { id } } }`, { id: config.productId });
      if (result.onetimeProduct?.id !== config.productId || result.onetimeProduct.status !== "active" || result.onetimeProduct.store.id !== config.storeId) throw new Error("One-time product unavailable");
      const expiresInSeconds = Math.floor((Date.parse(input.expiresAt) - Date.now()) / 1000);
      if (!Number.isFinite(expiresInSeconds) || expiresInSeconds < 60 || expiresInSeconds > 3600) throw new Error("Checkout preparation expired");
      const session = await required().checkout.authenticated.create({
        productId: config.productId, currency: "USD", buyerIdentity: `framelyn:${input.buyerId}`, buyerEmail: input.email || undefined,
        orderMerchantExternalId: input.reference,
        priceSnapshot: { amount: input.amount, taxCategory: TaxCategory.SaaS },
        metadata: { order_id: input.orderId, buyer_id: input.buyerId, nonce: input.nonce, market: "en", environment: config.mode },
        successUrl: `${config.site}/billing?order=${input.orderId}&checkout=returned`,
        expiresInSeconds, darkMode: true, language: "en",
      }, { idempotencyKey: `${config.merchantId}-${input.reference}` });
      const url = new URL(session.checkoutUrl);
      if (url.protocol !== "https:" || url.host !== "checkout.waffo.ai" || url.username || url.password) throw new Error("Invalid checkout URL");
      // Any warning about ignored fields must be reviewed rather than charging
      // the base product price while granting an unrelated local credit pack.
      if (session.warnings?.length) throw new Error("Provider did not accept all checkout settings");
      return { sessionId: session.sessionId, checkoutUrl: session.checkoutUrl, expiresAt: session.expiresAt };
    },
    async orders(reference: string) {
      if (!new RegExp(`^framelyn-${config.mode}-[0-9]{1,20}$`).test(reference)) throw new Error("Invalid order reference");
      const result = await query<{ onetimeOrders: ProviderOrder[] }>(`query($storeId: String!, $ref: String!) {
        onetimeOrders(storeId: $storeId, filter: { orderMerchantExternalId: { eq: $ref } }, limit: 21) { ${ORDER_FIELDS} }
      }`, { storeId: config.storeId, ref: reference });
      if (!Array.isArray(result.onetimeOrders) || result.onetimeOrders.length > 20) throw new Error("Order requires manual reconciliation");
      return result.onetimeOrders.map(order => {
        if (order.orderMerchantExternalId !== reference) throw new Error("Order reference mismatch");
        return normalizeOrder(order, config);
      });
    },
    verify(body: string, signature: string | undefined) {
      const event = verifyWebhook(body, signature, { environment: config.mode });
      if (event.mode !== config.mode || event.storeId !== config.storeId || !event.id || !event.eventId) throw new Error("Webhook scope mismatch");
      return { id: event.id, eventId: event.eventId, type: event.eventType, reference: event.data.orderMerchantExternalId || "", providerId: event.data.orderId };
    },
  };
}
export type Provider = ReturnType<typeof createProvider>;
