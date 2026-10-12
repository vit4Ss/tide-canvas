import assert from "node:assert/strict";
import test from "node:test";
import { catalogCreditValue } from "../src/lib/catalog-presentation.ts";

const model = (type, pointCost, config = {}) => ({ id: "test", modelKey: "test", name: "Test", type, pointCost, config });

test("catalog never presents a parameter-dependent model as a fixed-price request", () => {
  assert.equal(catalogCreditValue(model("image", "3", { priceMatrix: { high: { "1k": 4, "4k": 12 } } })), null);
  assert.equal(catalogCreditValue(model("image", "3", { pricing: { default: { "1k": 4 } } })), null);
  assert.equal(catalogCreditValue(model("3d", "10", { priceModifiers: { enable_pbr: 2 } })), null);
  assert.equal(catalogCreditValue(model("image", "3", { creditCost: 9 })), null);
  assert.equal(catalogCreditValue(model("video", "10")), null);
  assert.equal(catalogCreditValue(model("upscale", "2")), null);
});

test("known flat prices remain visible while unavailable prices are not called free", () => {
  assert.equal(catalogCreditValue(model("audio", "10")), 10);
  assert.equal(catalogCreditValue(model("image", "3", { creditCost: 3, priceMatrix: {} })), 3);
  for (const price of ["", "0", "missing", "Infinity", "-1", "0.5"]) assert.equal(catalogCreditValue(model("image", price)), null);
});
