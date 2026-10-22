import assert from "node:assert/strict";
import test from "node:test";
import { hasCanvasNodeInViewport } from "./canvas-viewport-visibility.ts";

const viewport = { width: 1280, height: 800 };
const identity = { x: 0, y: 0, k: 1 };
const node = { x: 120, y: 160, w: 608, h: 342 };

test("visible, partially visible, and viewport-spanning nodes count as present", () => {
  assert.equal(hasCanvasNodeInViewport([node], identity, viewport), true);
  assert.equal(hasCanvasNodeInViewport([{ x: -600, y: 200, w: 608, h: 342 }], identity, viewport), true);
  assert.equal(hasCanvasNodeInViewport([{ x: -200, y: -100, w: 1800, h: 1200 }], identity, viewport), true);
});

test("panning beyond every edge leaves no visible nodes, but any remaining node suppresses the notice", () => {
  for (const transform of [
    { x: -728, y: 0, k: 1 },
    { x: 1160, y: 0, k: 1 },
    { x: 0, y: -502, k: 1 },
    { x: 0, y: 640, k: 1 },
  ]) assert.equal(hasCanvasNodeInViewport([node], transform, viewport), false);

  assert.equal(hasCanvasNodeInViewport([node, { x: 2000, y: 160, w: 608, h: 342 }], { x: -1400, y: 0, k: 1 }, viewport), true);
});

test("visibility follows zoomed world coordinates and fractional edge intersections", () => {
  assert.equal(hasCanvasNodeInViewport([node], { x: -480, y: 0, k: 0.66 }, viewport), true);
  assert.equal(hasCanvasNodeInViewport([node], { x: -481, y: 0, k: 0.66 }, viewport), false);
  assert.equal(hasCanvasNodeInViewport([node], { x: -1200, y: -200, k: 2 }, viewport), true);
});

test("desktop sidebar dimensions bound visibility in canvas-local coordinates", () => {
  const sidebarViewport = { width: 704, height: 800 };
  const rightNode = { x: 720, y: 100, w: 200, h: 200 };
  assert.equal(hasCanvasNodeInViewport([rightNode], identity, viewport), true);
  assert.equal(hasCanvasNodeInViewport([rightNode], identity, sidebarViewport), false);
  assert.equal(hasCanvasNodeInViewport([rightNode], { x: -32, y: 0, k: 1 }, sidebarViewport), true);
});

test("actual narrow and tall media bounds determine visibility, not their nominal container", () => {
  // nodeRenderRect centers a 160px portrait within its 608px nominal width.
  const actualPortrait = { x: -300 + (608 - 160) / 2, y: -900, w: 160, h: 1200 };
  assert.equal(hasCanvasNodeInViewport([actualPortrait], identity, viewport), true);
  assert.equal(hasCanvasNodeInViewport([{ ...actualPortrait, h: 342 }], identity, viewport), false);
});

test("empty or unmeasured canvases cannot report a visible node", () => {
  assert.equal(hasCanvasNodeInViewport([], identity, viewport), false);
  assert.equal(hasCanvasNodeInViewport([node], identity, { width: 0, height: 800 }), false);
  assert.equal(hasCanvasNodeInViewport([{ ...node, w: 0 }], identity, viewport), false);
});
