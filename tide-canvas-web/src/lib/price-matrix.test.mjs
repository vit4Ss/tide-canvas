import assert from "node:assert/strict";
import test from "node:test";
import {
  configuredMatrix,
  durationVariants,
  keyVariants,
  matrixPrice,
  resolveImageToolPointCost,
  resolveUpscalePointCost,
  resolveUpscalePointRate,
} from "./price-matrix.ts";

test("upscale pricing selects the target-resolution rate and rounds the final cost", () => {
  const config = { pricePerSecondByResolution: { "1080p": "1.25", "4K": 3 } };
  assert.equal(resolveUpscalePointRate(config, "1080P"), 1.25);
  assert.equal(resolveUpscalePointRate(config, "4k"), 3);
  assert.equal(resolveUpscalePointCost(config, 4.2, "4K", 50), 13);
});

test("upscale uniform per-second pricing remains a rolling-upgrade fallback", () => {
  const config = { pricePerSecond: "1.25", pricing: { default: { "4k": 120 } }, creditCost: 80 };
  assert.equal(resolveUpscalePointRate(config, "4k"), 1.25);
  assert.equal(resolveUpscalePointCost(config, 4.2, "4K", 50), 6);
  assert.equal(resolveUpscalePointCost(config, 0, "4K", 50), 0);
});

test("upscale no longer falls back to fixed or legacy matrix pricing", () => {
  assert.equal(resolveUpscalePointCost({ pricing: { default: { "4k": 120 } }, creditCost: 80 }, 10, "4K", 50), 0);
});

test("image tool pricing follows quality and clarity including legacy matrices", () => {
  assert.equal(resolveImageToolPointCost(
    { pricing: { high: { "4k": "60" } } },
    { quality: "high", clarity: "4K" },
    18,
  ), 60);
  assert.equal(resolveImageToolPointCost({ creditCost: 12.2 }, {}, 4), 13);
  assert.equal(resolveImageToolPointCost({ creditCost: 12.2 }, { batchCount: 3 }, 4), 37);
  assert.equal(resolveImageToolPointCost({ creditCost: 2 }, { batch: 99 }, 4), 8);
});

test("new priceMatrix wins, while an empty one falls back to the legacy pricing alias", () => {
  const input = { quality: "high", clarity: "4K" };
  assert.equal(resolveImageToolPointCost({
    priceMatrix: {},
    pricing: { high: { "4k": 60 } },
  }, input, 18), 60);
  assert.equal(resolveImageToolPointCost({
    priceMatrix: { high: { "4k": 70 } },
    pricing: { high: { "4k": 60 } },
  }, input, 18), 70);
});

test("video matrix lookup tolerates duration suffix, resolution case, and flipped axes", () => {
  const matrix = configuredMatrix({
    priceMatrix: { "720p": { "7s": 49, "8s": "56" } },
  });
  assert.equal(matrixPrice(matrix, durationVariants(7), keyVariants("720P")), 49);
  assert.equal(matrixPrice(matrix, durationVariants("8"), keyVariants("720P")), 56);
});
