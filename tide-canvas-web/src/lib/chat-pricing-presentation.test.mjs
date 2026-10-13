import assert from "node:assert/strict";
import test from "node:test";
import { chatModelFamily, chatRateCNY } from "./chat-pricing-presentation.ts";

test("chat rates display the chosen 10 points per yuan conversion, including cached fractions", () => {
  assert.equal(chatRateCNY("20"), "2.00");
  assert.equal(chatRateCNY("100"), "10.00");
  assert.equal(chatRateCNY("0.2"), "0.02");
  assert.equal(chatRateCNY("0"), "0.00");
  for (const value of [undefined, "", "bad", "-1", "Infinity"]) assert.equal(chatRateCNY(value), "—");
});
test("model series tabs follow actual model IDs", () => {
  assert.equal(chatModelFamily("flowinglight/gpt-6.1-sol"), "gpt");
  assert.equal(chatModelFamily("codex-auto-review"), "gpt");
  assert.equal(chatModelFamily("claude-sonnet"), "claude");
  assert.equal(chatModelFamily("grok-4"), "grok");
  assert.equal(chatModelFamily("unknown"), "other");
});
