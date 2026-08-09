import assert from "node:assert/strict";
import test from "node:test";
import {
  assistantChatRetryDelay,
  isAmbiguousAssistantCreateCode,
  isTerminalAssistantLookupCode,
  normalizeAssistantChatRequest,
  normalizeAssistantTaskId,
  writeVerifiedAssistantRecoverySnapshot,
} from "../../features/canvas/application/assistant/assistant-chat-recovery.ts";

const validSnapshot = {
  clientRequestId: "canvas-chat-request-1",
  userMessageId: "user-1",
  modelId: "model-1",
  input: {
    prompt: "生成一张海报",
    messages: [{ role: "user", content: "此前上下文" }],
    attachments: [{ name: "ref.png", url: "https://example.com/ref.png", type: "image", size: 12 }],
  },
  createdAt: 123,
};

test("normalizes a frozen assistant request without changing its payload", () => {
  assert.deepEqual(normalizeAssistantChatRequest(validSnapshot), validSnapshot);
  assert.equal(normalizeAssistantChatRequest({ ...validSnapshot, clientRequestId: "x".repeat(97) }), null);
  assert.equal(normalizeAssistantChatRequest({ ...validSnapshot, clientRequestId: "   " }), null);
  assert.equal(normalizeAssistantChatRequest({ ...validSnapshot, clientRequestId: " request-with-padding " }), null);
  assert.equal(normalizeAssistantChatRequest({ ...validSnapshot, userMessageId: "  " }), null);
  assert.equal(normalizeAssistantChatRequest({ ...validSnapshot, modelId: "  " }), null);
  assert.equal(normalizeAssistantChatRequest({ ...validSnapshot, input: { ...validSnapshot.input, messages: [{}] } }), null);
});

test("only ambiguous create errors retain a paid request id", () => {
  for (const code of [0, 401, 408, 429, 500, 503]) assert.equal(isAmbiguousAssistantCreateCode(code), true);
  for (const code of [400, 403, 404, 422, 2001, 2002, 3002]) assert.equal(isAmbiguousAssistantCreateCode(code), false);
});

test("task lookup only terminates on explicit forbidden or missing", () => {
  for (const code of [403, 404]) assert.equal(isTerminalAssistantLookupCode(code), true);
  for (const code of [0, 400, 401, 408, 429, 500]) assert.equal(isTerminalAssistantLookupCode(code), false);
});

test("stored task ids only resume valid snowflake strings", () => {
  assert.equal(normalizeAssistantTaskId(" 1900012345678901234 "), "1900012345678901234");
  assert.equal(normalizeAssistantTaskId("not-a-task"), undefined);
  assert.equal(normalizeAssistantTaskId(""), undefined);
  assert.equal(normalizeAssistantTaskId(123), undefined);
});

test("retry cadence backs off and becomes slow reconciliation after the foreground budget", () => {
  assert.equal(assistantChatRetryDelay(1, false), 1_500);
  assert.equal(assistantChatRetryDelay(4, false), 12_000);
  assert.equal(assistantChatRetryDelay(20, false), 12_000);
  assert.equal(assistantChatRetryDelay(1, true), 10_000);
  assert.equal(assistantChatRetryDelay(4, true), 12_000);
});

test("the paid-create durability barrier fails closed", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
  };
  assert.equal(writeVerifiedAssistantRecoverySnapshot(storage, "journal", "frozen"), true);
  assert.equal(values.get("journal"), "frozen");
  assert.equal(writeVerifiedAssistantRecoverySnapshot({
    getItem: () => null,
    setItem: () => {},
  }, "journal", "frozen"), false);
  assert.equal(writeVerifiedAssistantRecoverySnapshot({
    getItem: () => null,
    setItem: () => { throw new Error("quota"); },
  }, "journal", "frozen"), false);
});
