import test from "node:test";
import assert from "node:assert/strict";
import { usageDuration, usagePoints, usageTime, usageProtocol } from "./chat-usage.ts";

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
