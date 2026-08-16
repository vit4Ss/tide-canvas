import assert from "node:assert/strict";
import test from "node:test";
import {
  canvasHitMarginWorld,
  exceedsScreenDragThreshold,
  findTopmostCanvasNodeAt,
} from "./canvas-hit-testing.ts";

const node = (id, x, y, width = 100, height = 80) => ({
  id,
  type: "image",
  x,
  y,
  width,
  height,
  title: id,
});

test("connection hit tolerance stays constant in screen pixels", () => {
  assert.equal(canvasHitMarginWorld(28, 0.1), 280);
  assert.equal(canvasHitMarginWorld(28, 1), 28);
  assert.equal(canvasHitMarginWorld(28, 5), 5.6);
});

test("overlapping connection targets prefer the visually topmost node", () => {
  const nodes = [node("behind", 0, 0), node("front", 10, 10)];
  assert.equal(findTopmostCanvasNodeAt(nodes, { x: 20, y: 20 })?.id, "front");
  assert.equal(findTopmostCanvasNodeAt(nodes, { x: 20, y: 20 }, { excludeNodeId: "front" })?.id, "behind");
});

test("quick-add drag activation uses screen distance", () => {
  assert.equal(exceedsScreenDragThreshold({ x: 10, y: 10 }, { x: 33, y: 10 }, 24), false);
  assert.equal(exceedsScreenDragThreshold({ x: 10, y: 10 }, { x: 35, y: 10 }, 24), true);
});
