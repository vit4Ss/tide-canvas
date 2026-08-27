import assert from "node:assert/strict";
import test from "node:test";
import { nearestAspectRatio } from "./aspect-ratio.ts";

const POOL = ["1:1", "3:4", "4:3", "16:9", "9:16"];

test("landscape sources snap to the nearest landscape slot", () => {
  // 电路图这类横向长图（用户反馈的扩图案例）绝不能落到竖档
  assert.equal(nearestAspectRatio(2000, 1000, POOL), "16:9");
  assert.equal(nearestAspectRatio(1600, 1200, POOL), "4:3");
  assert.equal(nearestAspectRatio(1920, 1080, POOL), "16:9");
});

test("portrait and square sources snap symmetrically", () => {
  assert.equal(nearestAspectRatio(1000, 2000, POOL), "9:16");
  assert.equal(nearestAspectRatio(1200, 1600, POOL), "3:4");
  assert.equal(nearestAspectRatio(1024, 1024, POOL), "1:1");
  // 微横的近方图归 1:1，不被推去 4:3
  assert.equal(nearestAspectRatio(1100, 1000, POOL), "1:1");
});

test("invalid input or candidates fall back to null (caller omits the ratio)", () => {
  assert.equal(nearestAspectRatio(0, 100, POOL), null);
  assert.equal(nearestAspectRatio(100, Number.NaN, POOL), null);
  assert.equal(nearestAspectRatio(100, 100, []), null);
  assert.equal(nearestAspectRatio(100, 100, ["auto", "x:y"]), null);
  // 合法与非法混合时跳过非法项
  assert.equal(nearestAspectRatio(300, 100, ["auto", "16:9"]), "16:9");
});
