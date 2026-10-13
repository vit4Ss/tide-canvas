import test from "node:test";
import assert from "node:assert/strict";
import { checkoutUrl } from "../src/lib/billing.ts";

test("USD checkout accepts only the HTTPS Stripe hosted payment origin", () => {
  const valid = "https://checkout.stripe.com/c/pay/cs_test_fixture#fragment";
  assert.equal(checkoutUrl({ currency: "USD", payUrl: valid }), valid);
  for (const payUrl of ["javascript:alert(1)", "https://checkout.stripe.com.attacker.test/pay", "https://checkout.stripe.com@attacker.test/pay", "http://checkout.stripe.com/pay", "https://checkout.stripe.com:8443/pay", "/pay", "https://legacy-pay.example.test/pay"]) {
    assert.equal(checkoutUrl({ currency: "USD", payUrl }), "", payUrl);
    assert.equal(checkoutUrl({ payMethod: "stripe", payUrl }), "", payUrl);
  }
});

test("Legacy CNY order checkout retains its original provider", () => {
  assert.equal(checkoutUrl({ currency: "CNY", payUrl: "https://legacy-pay.example.test/pay" }), "https://legacy-pay.example.test/pay");
  assert.equal(checkoutUrl({}), "");
});
