import assert from "node:assert/strict";
import test from "node:test";

import {
  canvasConnectionGeometry,
  canvasConnectionLayerBounds,
} from "./canvas-connection-geometry.ts";

test("connection SVG bounds contain distant targets instead of using the implicit 300x150 viewport", () => {
  const geometry = canvasConnectionGeometry(368, 371, 630, 237);
  const bounds = canvasConnectionLayerBounds([geometry]);

  assert.ok(bounds);
  assert.ok(bounds.left <= geometry.minX);
  assert.ok(bounds.top <= geometry.minY);
  assert.ok(bounds.left + bounds.width >= geometry.maxX);
  assert.ok(bounds.top + bounds.height >= geometry.maxY);
  assert.ok(bounds.width > 300);
});

test("connection SVG bounds include control points for backwards curves and negative world coordinates", () => {
  const geometry = canvasConnectionGeometry(600, -40, 100, 260);
  const bounds = canvasConnectionLayerBounds([geometry], 16);

  assert.ok(bounds);
  assert.ok(geometry.minX < 100);
  assert.ok(geometry.maxX > 600);
  assert.equal(bounds.left, Math.floor(geometry.minX - 16));
  assert.equal(bounds.top, -56);
  assert.equal(bounds.viewBox, `${bounds.left} ${bounds.top} ${bounds.width} ${bounds.height}`);
});

test("an empty connection layer does not create a stray SVG hit surface", () => {
  assert.equal(canvasConnectionLayerBounds([]), null);
});

test("one malformed connection cannot hide every valid connection", () => {
  const valid = canvasConnectionGeometry(0, 0, 400, 200);
  const malformed = { path: "", minX: Number.NaN, minY: 0, maxX: 0, maxY: 0 };

  assert.deepEqual(
    canvasConnectionLayerBounds([malformed, valid]),
    canvasConnectionLayerBounds([valid]),
  );
  assert.equal(canvasConnectionLayerBounds([malformed]), null);
});
