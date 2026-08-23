import assert from "node:assert/strict";
import test from "node:test";

import { visibleShortcutCount } from "./tool-skill-shortcuts-layout.ts";

test("fills the row while reserving the final more-skills button", () => {
  // label 80 + more 90 + base gap 8; each tool adds width + gap.
  assert.equal(visibleShortcutCount(502, 80, 90, [100, 100, 100, 100], 8), 3);
  assert.equal(visibleShortcutCount(610, 80, 90, [100, 100, 100, 100], 8), 4);
});

test("never admits a partial button and tolerates a very narrow row", () => {
  assert.equal(visibleShortcutCount(285, 80, 90, [100, 60], 8), 0);
  assert.equal(visibleShortcutCount(286, 80, 90, [100, 60], 8), 1);
  assert.equal(visibleShortcutCount(100, 80, 90, [100], 8), 0);
  assert.equal(visibleShortcutCount(Number.NaN, 80, 90, [100], 8), 0);
  assert.equal(visibleShortcutCount(286, 80, 90, [100], Number.NaN), 1);
});
