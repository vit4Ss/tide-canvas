import assert from "node:assert/strict";
import test from "node:test";
import { initialUpscaleRates, normalizeUpscaleRates, upscaleAdminPriceRange } from "./admin-upscale-pricing.ts";

const resolutions = ["720p", "1080p", "2k", "4k"];

test("editing legacy uppercase price cells preserves their values", () => {
  assert.deepEqual(initialUpscaleRates({ pricePerSecondByResolution: { "1080P": "5", " 4K ": 9 } }, resolutions), { "1080p": "5", "4k": 9 });
  assert.deepEqual(normalizeUpscaleRates({ MAX: "2", " HIGH ": 2, medium: 1, low: 1 }), { max: "2", high: 2, medium: 1, low: 1 });
  assert.deepEqual(initialUpscaleRates({ pricePerSecond: 3, resolutions: ["4K"] }, resolutions), { "4k": 3 });
});

test("empty tables never revive old prices on edit or in the model list", () => {
  for (const table of [{}, null]) {
    const config = { pricePerSecondByResolution: table, pricePerSecond: 99 };
    assert.deepEqual(initialUpscaleRates(config, resolutions), {});
    assert.equal(upscaleAdminPriceRange(config, false, resolutions), null);
  }
  assert.equal(upscaleAdminPriceRange({ pricePerSecondByUpscaleModel: {}, pricePerSecond: 99 }, true, resolutions), null);
});

test("model list prices only cover active resolutions and require all RH tiers", () => {
  assert.deepEqual(upscaleAdminPriceRange({ resolutions: ["4K"], pricePerSecondByResolution: { "720p": 1, "4k": 3 } }, false, resolutions), { min: 3, max: 3, legacy: false });
  assert.deepEqual(upscaleAdminPriceRange({ pricePerSecondByUpscaleModel: { max: 2, high: 2, medium: 1, low: 1 } }, true, resolutions), { min: 1, max: 2, legacy: false });
  assert.equal(upscaleAdminPriceRange({ pricePerSecondByUpscaleModel: { max: 2 } }, true, resolutions), null);
  assert.deepEqual(upscaleAdminPriceRange({ pricePerSecond: 3 }, false, resolutions), { min: 3, max: 3, legacy: true });
});

test("duplicate aliases require admin correction instead of guessing a price", () => {
  assert.deepEqual(normalizeUpscaleRates({ "4K": 3, "4k": 9 }), { "4k": "" });
  assert.equal(upscaleAdminPriceRange({ resolutions: ["4k"], pricePerSecondByResolution: { "4K": 3, "4k": 9 } }, false, resolutions), null);
});
