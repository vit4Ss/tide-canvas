import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./viewport.tsx", import.meta.url), "utf8");

test("3D viewport rejects empty geometry and disposes every failed model resource", () => {
  assert.match(source, /if \(box\.isEmpty\(\)\) throw new Error/);
  assert.match(source, /const textures = new Set<THREE_NS\.Texture>\(\)/);
  assert.match(source, /Object\.values\(m as unknown as Record<string, unknown>\)/);
  assert.match(source, /if \(pendingGroup\) disposeObject\(pendingGroup\)/);
});
