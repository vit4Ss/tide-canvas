import assert from "node:assert/strict";
import test from "node:test";
import { buildWorkSnapshot } from "./work-insights.ts";

test("work metrics preserve missing counters and calculate only visible engagement", () => {
  const snapshot = buildWorkSnapshot({
    stats: { play: "10,000", like: "500", comment: "50", share: "25" },
  });
  assert.equal(snapshot.views, 10_000);
  assert.equal(snapshot.interactions, 575);
  assert.equal(snapshot.measuredFields, 3);
  assert.equal(snapshot.engagementRate, 5.75);
  assert.equal(snapshot.interactionParts.find((item) => item.key === "favorite")?.value, null);
  assert.equal(snapshot.interactionParts.find((item) => item.key === "like")?.rate, 5);
});

test("explicit zeros remain real data while wholly absent interaction metrics stay unknown", () => {
  const zero = buildWorkSnapshot({ stats: { play: "0", like: "0" } });
  assert.equal(zero.views, 0);
  assert.equal(zero.interactions, 0);
  assert.equal(zero.measuredFields, 1);
  assert.equal(zero.engagementRate, null);

  const missing = buildWorkSnapshot({ stats: { play: "100" } });
  assert.equal(missing.interactions, null);
  assert.equal(missing.measuredFields, 0);
  assert.equal(missing.engagementRate, null);
});
