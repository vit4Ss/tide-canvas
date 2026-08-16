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
  resolveVideoPointCost,
  videoPerRequestPointRange,
  videoPerRequestRate,
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

test("video per-request pricing uses resolution and never multiplies duration", () => {
  const config = {
    videoBillingMode: "per_request",
    resolutions: ["720p", "1080p"],
    pricePerRequestByResolution: { "720P": "12.1", "1080p": 25 },
    priceMatrix: { "4s": { "720p": 4 }, "20s": { "720p": 20 } },
    creditCost: 88,
  };
  assert.equal(resolveVideoPointCost(config, 4, "720p", 999), 13);
  assert.equal(resolveVideoPointCost(config, 20, "720P", 999), 13);
  assert.equal(resolveVideoPointCost(config, 4, "1080P", 999), 25);
  assert.equal(resolveVideoPointCost(config, 4, "4k", 999), 0);
});

test("switching video billing mode retains the duration matrix", () => {
  const config = {
    videoBillingMode: "duration",
    resolutions: ["720p"],
    pricePerRequestByResolution: { "720p": 9 },
    priceMatrix: { "4s": { "720p": 4 }, "8s": { "720p": 7 } },
  };
  assert.equal(resolveVideoPointCost(config, 4, "720p", 99), 4);
  assert.equal(resolveVideoPointCost(config, 8, "720p", 99), 7);
});

test("case-variant duplicate per-request rates fail closed", () => {
  assert.equal(videoPerRequestRate({
    resolutions: ["720p"],
    pricePerRequestByResolution: { "720p": 10, "720P": 11 },
  }, "720p"), 0);
});

test("video per-request range rounds every resolution and rejects partial pricing", () => {
  assert.deepEqual(videoPerRequestPointRange({
    videoBillingMode: "per_request",
    resolutions: ["720p", "1080P"],
    pricePerRequestByResolution: { "720P": "12.1", "1080p": 25 },
  }), { min: 13, max: 25 });
  assert.deepEqual(videoPerRequestPointRange({
    videoBillingMode: "per_request",
    resolutions: ["720p"],
    pricePerRequestByResolution: { "720p": 9 },
  }), { min: 9, max: 9 });
  assert.equal(videoPerRequestPointRange({
    videoBillingMode: "per_request",
    resolutions: ["720p", "1080p"],
    pricePerRequestByResolution: { "720p": 9 },
  }), null);
  assert.equal(videoPerRequestPointRange({
    videoBillingMode: "duration",
    resolutions: ["720p"],
    pricePerRequestByResolution: { "720p": 9 },
  }), null);
  assert.equal(videoPerRequestPointRange({
    videoBillingMode: "per_request",
    resolutions: ["720p"],
    pricePerRequestByResolution: { "720p": "9223372036854775808" },
  }), null);
});
