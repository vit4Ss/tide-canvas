import assert from "node:assert/strict";
import test from "node:test";
import { buildAccountSnapshot, parseMetricNumber } from "./account-insights.ts";

function resultWith(works, profile = { followers: "10,000" }) {
  return {
    platform: "bilibili",
    platformName: "哔哩哔哩",
    kind: "account",
    sourceUrl: "https://space.bilibili.com/1",
    profile,
    works,
    warnings: [],
    fetchedAt: Date.now(),
  };
}

test("metric parser accepts platform count formats and rejects ambiguous values", () => {
  assert.equal(parseMetricNumber("1,330"), 1330);
  assert.equal(parseMetricNumber("1.2 万"), 12_000);
  assert.equal(parseMetricNumber("3.4M"), 3_400_000);
  assert.equal(parseMetricNumber("0"), 0);
  assert.equal(parseMetricNumber("约 1 万"), null);
  assert.equal(parseMetricNumber("—"), null);
  assert.equal(parseMetricNumber("-2"), null);
});

test("account snapshot derives sample metrics without mixing unknown-view interactions", () => {
  const snapshot = buildAccountSnapshot(resultWith([
    { id: "a", publishedAt: "2026-01-01", stats: { play: "1000", like: "100", comment: "10", share: "5", favorite: "5" } },
    { id: "b", publishedAt: "2026-01-08", stats: { play: "500", like: "50" } },
    // This work has interactions but no view denominator. It belongs in total
    // interactions, but must not inflate the sample engagement rate.
    { id: "c", publishedAt: "2026-01-15", stats: { like: "100" } },
  ]));

  assert.equal(snapshot.measuredViews, 2);
  assert.equal(snapshot.totalViews, 1500);
  assert.equal(snapshot.averageViews, 750);
  assert.equal(snapshot.medianViews, 750);
  assert.equal(snapshot.medianEngagementRate, 11);
  assert.equal(snapshot.highPerformanceRate, 0);
  assert.ok(Math.abs((snapshot.topPerformanceMultiple ?? 0) - 4 / 3) < 1e-9);
  assert.equal(snapshot.totalInteractions, 270);
  assert.equal(snapshot.measuredInteractions, 3);
  assert.ok(Math.abs((snapshot.engagementRate ?? 0) - (170 / 1500) * 100) < 1e-9);
  assert.equal(snapshot.viewToFollowerRate, 7.5);
  assert.ok(Math.abs((snapshot.topConcentration ?? 0) - (1000 / 1500) * 100) < 1e-9);
  assert.equal(snapshot.rankedWorks.map((item) => item.work.id).join(","), "a,b,c");
  assert.equal(snapshot.measuredPublished, 3);
  assert.ok(Math.abs((snapshot.postsPerWeek ?? 0) - 1.4) < 1e-9);
});

test("account snapshot falls back to interaction ranking without inventing view rates", () => {
  const snapshot = buildAccountSnapshot(resultWith([
    { id: "a", stats: { like: "8", comment: "2" } },
    { id: "b", stats: { like: "20" } },
  ]));

  assert.equal(snapshot.rankingLabel, "互动");
  assert.equal(snapshot.rankedWorks.map((item) => item.work.id).join(","), "b,a");
  assert.equal(snapshot.totalViews, null);
  assert.equal(snapshot.averageViews, null);
  assert.equal(snapshot.engagementRate, null);
  assert.equal(snapshot.topConcentration, null);
  assert.equal(snapshot.postsPerWeek, null);
});

test("explicit zero interaction data stays distinct from an unavailable metric", () => {
  const snapshot = buildAccountSnapshot(resultWith([
    { id: "a", stats: { play: "0", like: "0" } },
    { id: "b", stats: {} },
  ]));

  assert.equal(snapshot.rankingLabel, "平台顺序");
  assert.equal(snapshot.measuredInteractions, 1);
  assert.equal(snapshot.totalInteractions, 0);
  assert.equal(snapshot.averageInteractions, 0);
  assert.equal(snapshot.interactionParts.find((item) => item.key === "like")?.measured, 1);
  assert.equal(snapshot.interactionParts.find((item) => item.key === "comment")?.measured, 0);
  assert.equal(snapshot.engagementRate, null);
});
