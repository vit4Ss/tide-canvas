import assert from "node:assert/strict";
import test from "node:test";
import { resolveImageToolPointCost, resolveUpscalePointCost, resolveUpscalePointRate } from "./price-matrix.ts";

test("upscale pricing follows the default row and rounds like the server", () => {
  assert.equal(resolveUpscalePointCost({ priceMatrix: { default: { "1080p": "12.2" } }, creditCost: 4 }, 0, "1080P", 2), 13);
});

test("upscale pricing accepts a transposed matrix", () => {
  assert.equal(resolveUpscalePointCost({ priceMatrix: { "2k": { default: "18" } } }, 0, "2K", 2), 18);
});

test("upscale pricing accepts legacy matrices and server-compatible fixed prices", () => {
  assert.equal(resolveUpscalePointCost({ pricing: { default: { "4k": 120 } } }, 0, "4K", 50), 120);
  assert.equal(resolveUpscalePointCost({ creditCost: 7.1 }, 0, "4k", 3), 8);
  assert.equal(resolveUpscalePointCost(undefined, 0, "4k", "9.2"), 9);
  assert.equal(resolveUpscalePointCost(undefined, 0, "4k", 0), 0);
});

test("upscale per-second pricing takes precedence and rounds the final cost up", () => {
  const config = { pricePerSecond: "1.25", pricing: { default: { "4k": 120 } }, creditCost: 80 };
  assert.equal(resolveUpscalePointRate(config), 1.25);
  assert.equal(resolveUpscalePointCost(config, 4.2, "4K", 50), 6);
  assert.equal(resolveUpscalePointCost(config, 0, "4K", 50), 0);
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
