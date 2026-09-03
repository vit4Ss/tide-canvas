import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node's native TypeScript loader requires the source suffix.
import { resolvedResultCells, type ResultCellSeed } from "./resolved-result-cells.ts";

function seeds(count: number): ResultCellSeed[] {
  return Array.from({ length: count }, (_, i) => ({ i, hues: [i, i + 1, i + 2] }));
}

test("a one-request Midjourney task renders all four returned images immediately", () => {
  const urls = ["one.png", "two.png", "three.png", "four.png"];
  const cells = resolvedResultCells(seeds(1), urls, "image");

  assert.equal(cells.length, 4);
  assert.deepEqual(cells.map((cell) => cell.url), urls);
  assert.deepEqual(cells.map((cell) => cell.i), [0, 1, 2, 3]);
});

test("a partial image batch shows only real outputs and never duplicates the first", () => {
  const urls = ["one.png", "two.png"];
  const cells = resolvedResultCells(seeds(4), urls, "image");

  assert.equal(cells.length, 2);
  assert.deepEqual(cells.map((cell) => cell.url), urls);
});

test("audio keeps every returned track while 3D keeps one card for multiple formats", () => {
  const urls = ["first.bin", "second.bin"];

  assert.equal(resolvedResultCells(seeds(1), urls, "audio").length, 2);
  assert.deepEqual(
    resolvedResultCells(seeds(1), urls, "3d").map((cell) => cell.url),
    ["first.bin"],
  );
});
