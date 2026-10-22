import assert from "node:assert/strict";
import test from "node:test";
import { resolveContextMenuLayout } from "./canvas-context-menu-layout.ts";

const viewport = { width: 1280, height: 800 };
const menu = { width: 240, height: 264 };

test("opens at the pointer when the complete menu fits", () => {
  assert.deepEqual(resolveContextMenuLayout({ anchor: { x: 320, y: 160 }, menu, viewport }), {
    left: 320, top: 160, maxHeight: 632,
  });
});

test("clamps each desktop viewport edge while retaining the full initial menu", () => {
  assert.deepEqual(resolveContextMenuLayout({ anchor: { x: 1270, y: 790 }, menu, viewport }), {
    left: 1032, top: 528, maxHeight: 264,
  });
  assert.deepEqual(resolveContextMenuLayout({ anchor: { x: -10, y: -20 }, menu, viewport }), {
    left: 8, top: 8, maxHeight: 784,
  });
});

test("submenu growth and returning to the main view preserve the opening position", () => {
  const anchor = { x: 1100, y: 640 };
  const initial = resolveContextMenuLayout({ anchor, menu, viewport });
  const expanded = resolveContextMenuLayout({
    anchor, menu: { ...menu, height: 640 }, viewport, previous: initial,
  });
  assert.deepEqual(expanded, initial);
  assert.deepEqual(resolveContextMenuLayout({ anchor, menu, viewport, previous: expanded }), initial);
});

test("even a short main menu reserves a stable usable submenu scroll region", () => {
  const anchor = { x: 300, y: 780 };
  const initial = resolveContextMenuLayout({ anchor, menu: { ...menu, height: 80 }, viewport });
  assert.equal(initial.top, 672);
  assert.equal(initial.maxHeight, 120);
  assert.deepEqual(resolveContextMenuLayout({
    anchor, menu: { ...menu, height: 640 }, viewport, previous: initial,
  }), initial);
});

test("desktop window shrink keeps the menu reachable and window growth does not move it back", () => {
  const anchor = { x: 1100, y: 640 };
  const previous = resolveContextMenuLayout({ anchor, menu, viewport });
  const resized = resolveContextMenuLayout({
    anchor, menu: { ...menu, height: 640 }, viewport: { width: 1024, height: 500 }, previous,
  });
  assert.deepEqual(resized, { left: 776, top: 372, maxHeight: 120 });
  assert.deepEqual(resolveContextMenuLayout({ anchor, menu, viewport, previous: resized }), {
    left: 776, top: 372, maxHeight: 420,
  });
});

test("a long initial menu uses the height available in a short desktop window", () => {
  assert.deepEqual(resolveContextMenuLayout({
    anchor: { x: 600, y: 240 }, menu: { width: 240, height: 640 },
    viewport: { width: 1024, height: 320 },
  }), { left: 600, top: 8, maxHeight: 304 });
});
