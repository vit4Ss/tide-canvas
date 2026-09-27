import test from "node:test";
import assert from "node:assert/strict";
import { usageDuration, usagePoints, usageTime, usageProtocol, usageDateRange, usageDateParts, usageCachePercent, usageDecimal, usagePercent } from "./chat-usage.ts";

test("usage timings distinguish unmeasured from a real zero", () => {
  assert.equal(usageDuration(null), "—");
  assert.equal(usageDuration(undefined), "—");
  assert.equal(usageDuration(-1), "—");
  assert.equal(usageDuration(0), "0 ms");
  assert.equal(usageDuration(732), "732 ms");
  assert.equal(usageDuration(1234), "1.23 s");
  assert.equal(usageDuration(71500), "1m 11s");
});

test("pending usage never displays the held or unconfirmed cost as paid", () => {
  for (const status of ["pending", "billing_pending"]) assert.equal(usagePoints({status, points:"99"}), "待结算");
  assert.equal(usagePoints({status:"success", points:"0.000001"}), "0.000001");
  assert.equal(usagePoints({status:"failed", points:"0"}), "0");
  assert.equal(usagePoints({status:"success", points:"7", netPoints:"0"}), "0");
  assert.equal(usagePoints({status:"partial", points:"7", netPoints:"4"}), "4");
});

test("protocol comes from the client route, not the upstream conversion", () => {
  assert.equal(usageProtocol("/api/integrations/v1/responses"), "Responses");
  assert.equal(usageProtocol("/api/integrations/v1/chat/completions"), "Chat Completions");
  assert.equal(usageProtocol(""), "—");
});

test("displayed date agrees with Beijing date filters across timezones", () => {
  assert.match(usageTime("2026-09-20T16:05:00Z"), /2026\/9\/21.*00:05:00/);
  assert.equal(usageTime("invalid"), "—");
});

test("date presets use inclusive Beijing calendar days across month and year boundaries", () => {
  const now = new Date("2026-12-31T16:01:00Z");
  assert.deepEqual(usageDateRange("all", now), { startDate: "", endDate: "" });
  assert.deepEqual(usageDateRange("today", now), { startDate: "2027-01-01", endDate: "2027-01-01" });
  assert.deepEqual(usageDateRange("7d", now), { startDate: "2026-12-26", endDate: "2027-01-01" });
  assert.deepEqual(usageDateRange("30d", now), { startDate: "2026-12-03", endDate: "2027-01-01" });
  assert.deepEqual(usageDateRange("7d", new Date("2028-03-01T00:00:00+08:00")), { startDate: "2028-02-24", endDate: "2028-03-01" });
  assert.deepEqual(usageDateRange("today", new Date("2026-09-20T15:59:59Z")), { startDate: "2026-09-20", endDate: "2026-09-20" });
});

test("cache ratio distinguishes no measured input from a measured zero hit rate", () => {
  for (const [input, cached] of [[0, 0], [-1, 0], [10, -1], [10, 11], [NaN, 0], [100, Infinity]]) {
    assert.equal(usageCachePercent(input, cached), null);
  }
  assert.equal(usageCachePercent(100, 0), 0);
  assert.equal(usageCachePercent(100, 25), 25);
  assert.equal(usageCachePercent(100, 100), 100);
});

test("split timestamps show the same Beijing date and time as filters", () => {
  assert.deepEqual(usageDateParts("2026-09-20T16:05:00Z"), { date: "2026-09-21", time: "00:05:00" });
  assert.deepEqual(usageDateParts("invalid"), { date: "—", time: "—" });
});

test("billing display preserves exact micro-points beyond floating-point precision", () => {
  assert.equal(usageDecimal("1234567890123.123456"), "1,234,567,890,123.123456");
  assert.equal(usageDecimal("0.000001"), "0.000001");
  assert.equal(usageDecimal("00120.400000"), "120.4");
  assert.equal(usageDecimal("0.000000"), "0");
  assert.equal(usageDecimal("-1234.500000"), "-1,234.5");
  for (const value of [null, undefined, "", "NaN", "Infinity", "1e6"]) assert.equal(usageDecimal(value), "—");
  assert.equal(usagePoints({status:"success", points:"1234567890123.123456"}), "1,234,567,890,123.123456");
});

test("small cache ratios never imply zero or full cache coverage", () => {
  assert.equal(usagePercent(0), "0.0");
  assert.equal(usagePercent(0.0001), "<0.1");
  assert.equal(usagePercent(99.99), ">99.9");
  assert.equal(usagePercent(100), "100.0");
  assert.equal(usagePercent(32.18), "32.2");
  for (const value of [null, NaN, -1, 101]) assert.equal(usagePercent(value), "—");
});
