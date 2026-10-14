import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { readConfig } from "../dist/config.js";
import { createProvider, normalizeOrder, cents, orderMetadata } from "../dist/waffo.js";
import { createAdapter } from "../dist/http.js";

const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKey = pair.privateKey.export({ type: "pkcs8", format: "pem" });
const publicKey = pair.publicKey.export({ type: "spki", format: "pem" });
const config = readConfig({ PAYMENTS_INTERNAL_TOKEN: "adapter-test-token-".repeat(3), WAFFO_PRIVATE_KEY: privateKey,
  WAFFO_MERCHANT_ID: "MER_2HQcr4GpEfaaTxdlz2EhR4", WAFFO_STORE_ID: "STO_5sCh2znmw67eD0IDcdYF7r",
  WAFFO_PRODUCT_ID: "PROD_2aUyqjCzEIiEcYMKj7TZtw", WAFFO_ENV: "test", WAFFO_SITE_URL: "http://localhost:3100" });
const input = { mode: "test", orderId: "901", reference: "framelyn-test-901", buyerId: "701", amount: "12.50",
  nonce: "a".repeat(64), expiresAt: new Date(Date.now() + 3500_000).toISOString(), productId: config.productId, storeId: config.storeId };
function fixtureOrder() {
  const amount = { currency: "USD", subtotal: "12.50", taxAmount: "1.25", total: "13.75" };
  return { id: "ORD_123", status: "completed", currency: "USD", testMode: true, orderMerchantExternalId: input.reference,
    metadata: { nonce: input.nonce, order_id: input.orderId, buyer_id: input.buyerId, market: "en", environment: "test" }, store: { id: config.storeId }, onetimeProduct: { id: config.productId },
    priceSnapshot: amount, payments: [{ id: "PAY_123", status: "succeeded", refundStatus: null, snapshotAmountDetails: amount, refunds: [] }] };
}
test("SDK sends display amounts, authenticated ownership and a stable checkout idempotency key", async () => {
  const calls = [];
  const provider = createProvider(config, async (url, init) => {
    const body = JSON.parse(init.body); calls.push({ url: String(url), init, body });
    assert.ok(new Headers(init.headers).get("x-signature"));
    if (String(url).endsWith("/graphql")) return Response.json({ data: { onetimeProduct: { id: config.productId, status: "active", store: { id: config.storeId } } } });
    if (String(url).endsWith("issue-session-token")) return Response.json({ data: { token: "test-token", expiresAt: input.expiresAt } });
    return Response.json({ data: { sessionId: "cs_123", checkoutUrl: "https://pancake.waffo.ai/store/checkout/cs_123", expiresAt: input.expiresAt } });
  });
  for (let i = 0; i < 2; i++) assert.match((await provider.checkout(input)).checkoutUrl, /#token=test-token$/);
  const writes = calls.filter(c => c.url.endsWith("checkout/create-session"));
  assert.equal(writes.length, 2);
  for (const call of writes) {
    assert.deepEqual(call.body.priceSnapshot, { amount: "12.50", taxCategory: "saas" });
    assert.equal(call.body.orderMerchantExternalId, input.reference);
    assert.equal(call.body.metadata.nonce, input.nonce);
    assert.equal(call.body.successUrl, "http://localhost:3100/billing?order=901&checkout=returned");
    assert.equal(new Headers(call.init.headers).get("x-idempotency-key"), `${config.merchantId}-${input.reference}`);
  }
  assert.equal(calls.find(c => c.url.endsWith("issue-session-token")).body.buyerIdentity, "framelyn:701");
  await assert.rejects(provider.checkout({ ...input, mode: "prod" }));
  await assert.rejects(provider.checkout({ ...input, productId: "PROD_other" }));
});
test("canonical order validates tax and environment, and cumulatively deduplicates refunds", () => {
  const order = fixtureOrder();
  assert.equal(normalizeOrder(order, config).subtotal, "12.50");
  const refund = { id: "REF_1", status: "succeeded", pspAmountDetails: { currency: "USD", amount: "6.00" } };
  order.payments[0].refunds = [refund, refund, { ...refund, id: "REF_2", pspAmountDetails: { currency: "USD", amount: "0.25" } }];
  assert.equal(normalizeOrder(order, config).refunded, "6.25");
  assert.throws(() => normalizeOrder({ ...order, testMode: false }, config));
  assert.throws(() => normalizeOrder({ ...order, store: { id: "STO_other" } }, config));
  assert.throws(() => normalizeOrder({ ...order, payments: [] }, config));
  assert.throws(() => normalizeOrder({ ...order, priceSnapshot: { ...order.priceSnapshot, total: "1.00" } }, config));
  for (const value of [NaN, "-1.00", "1e2", "0.001", "Infinity"]) assert.throws(() => cents(value));
});
test("SDK verifies raw signed payload, replay tolerance, and explicit test/store boundaries", () => {
  const previous = process.env.WAFFO_WEBHOOK_TEST_PUBLIC_KEY;
  process.env.WAFFO_WEBHOOK_TEST_PUBLIC_KEY = publicKey;
  try {
    const provider = createProvider(config);
    const body = JSON.stringify({ id: "delivery-1", eventId: "PAY_1", storeId: config.storeId, mode: "test", eventType: "order.completed", data: { orderId: "ORD_1", orderMerchantExternalId: input.reference } });
    const signed = (value, timestamp = Date.now()) => `t=${timestamp},v1=${sign("RSA-SHA256", Buffer.from(`${timestamp}.${value}`), pair.privateKey).toString("base64")}`;
    assert.equal(provider.verify(body, signed(body)).reference, input.reference);
    assert.throws(() => provider.verify(body + " ", signed(body)));
    assert.throws(() => provider.verify(body, signed(body, Date.now() - 3600_000)));
    assert.throws(() => provider.verify(body, signed(body, Date.now() + 120_000)));
    for (const mutated of [body.replace('"test"', '"prod"'), body.replace(config.storeId, "STO_other")]) assert.throws(() => provider.verify(mutated, signed(mutated)));
  } finally { if (previous === undefined) delete process.env.WAFFO_WEBHOOK_TEST_PUBLIC_KEY; else process.env.WAFFO_WEBHOOK_TEST_PUBLIC_KEY = previous; }
});
test("adapter rejects unauthenticated requests and never returns upstream error details", async t => {
  const provider = { checkout: async () => { throw new Error("secret-must-not-leak"); }, orders: async () => [], verify: () => { throw new Error("invalid"); } };
  const server = createAdapter(config, provider); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(url + "/checkout", { method: "POST" })).status, 401);
  const options = { method: "POST", headers: { Authorization: `Bearer ${config.token}` }, body: JSON.stringify(input) };
  const response = await fetch(url + "/checkout", options);
  assert.equal(response.status, 502); assert.equal((await response.text()).includes("secret"), false);
  assert.equal((await fetch(url + "/orders", { ...options, body: JSON.stringify({ mode: "prod" }) })).status, 400);
});
test("runtime configuration requires loopback and HTTPS in production", () => {
  assert.throws(() => readConfig({ PAYMENTS_INTERNAL_TOKEN: config.token, WAFFO_ENV: "prod" }));
  assert.throws(() => readConfig({ PAYMENTS_INTERNAL_TOKEN: config.token, PAYMENTS_HOST: "0.0.0.0" }));
  assert.throws(() => readConfig({ PAYMENTS_INTERNAL_TOKEN: "short" }));
  assert.equal(readConfig({ PAYMENTS_INTERNAL_TOKEN: config.token }).ready, false);
});
test("SDK canonical query scopes the store/reference and fails closed on GraphQL errors", async () => {
 let fail = false;
 const provider = createProvider(config, async (_url, init) => {
   const {query, variables} = JSON.parse(init.body);
   assert.equal(variables.storeId, config.storeId);
   assert.equal(variables.ref, input.reference);
   assert.match(query, /orderMerchantExternalId/);
   return Response.json(fail ? {data:null,errors:[{message:"fixture"}]} : {data:{onetimeOrders:[fixtureOrder()]}});
 });
 const result = await provider.orders(input.reference);
 assert.equal(result[0].paid, true); assert.equal(result[0].total, "13.75");
 fail = true; await assert.rejects(provider.orders(input.reference));
 await assert.rejects(provider.orders("framelyn-prod-901"));
});
test("hosted GraphQL JSON-string metadata preserves exact order ownership", () => {
  const order=fixtureOrder();
  const object=normalizeOrder(order,config);
  const serialized=normalizeOrder({...order,metadata:JSON.stringify(order.metadata)},config);
  assert.deepEqual(serialized.metadata,object.metadata);
  assert.equal(serialized.metadata.nonce,input.nonce);
  for(const value of [null,[],"not JSON",'"text"','[]','{}',JSON.stringify({...order.metadata,buyer_id:701})]) assert.throws(()=>orderMetadata(value));
});


test("SDK screens before generation using enforce and rejects malformed verdicts", async () => {
 let result = { action: "allow", reasonCode: "allowed", requestId: "REQ_1" };
 const provider = createProvider(config, async (url, init) => {
  assert.match(String(url), /verification\/scan-prompt$/);
  assert.deepEqual(JSON.parse(init.body), {prompt:"A mountain",locale:"en",semantic:"enforce"});
  assert.ok(new Headers(init.headers).get("x-signature"));
  return Response.json({data:result});
 });
 assert.equal((await provider.scanPrompt("A mountain")).action,"allow");
 for (const action of ["block","review"]) {
  result={action,reasonCode: action === "block" ? "restricted_content" : "review_required",requestId:"REQ_1"};
  assert.equal((await provider.scanPrompt("A mountain")).action,action);
 }
 for (const invalid of [{action:"allow"},{action:"allow",reasonCode:"service_degraded",requestId:"REQ_1"}]) {
  result=invalid; await assert.rejects(provider.scanPrompt("A mountain"));
 }
 for (const prompt of ["", " ", "a".repeat(10001), null]) await assert.rejects(provider.scanPrompt(prompt));
});

test("screening endpoint is internal, validates environment and never leaks prompts or upstream errors", async t => {
 let count=0;
 const server=createAdapter(config,{scanPrompt:async()=>{count++;throw new Error("private prompt and credentials");}});
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const url=`http://127.0.0.1:${server.address().port}/scan-prompt`;
 assert.equal((await fetch(url,{method:"POST"})).status,401);
 const send=body=>fetch(url,{method:"POST",headers:{Authorization:`Bearer ${config.token}`},body:JSON.stringify(body)});
 assert.equal((await send({mode:"prod",prompt:"safe"})).status,400);
 assert.equal((await send({mode:"test",prompt:""})).status,400);
 assert.equal(count,0);
 const response=await send({mode:"test",prompt:"safe"});
 assert.equal(response.status,502);assert.equal((await response.text()).includes("private"),false);
});
