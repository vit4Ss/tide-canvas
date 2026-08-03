import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node's native TypeScript loader requires the source suffix.
import { arbitratePendingTurn, removePendingTurnIfOwned, type PendingTurnDescriptor } from "./pending-turn-arbitration.ts";

interface Row {
  clientRequestId: string;
}

function turn(
  kind: "media" | "text",
  ownerKey: string,
  conversationId: string,
  requestKey: string,
  clientRequestId: string,
): PendingTurnDescriptor<Row> {
  return {
    kind,
    ownerKey,
    conversationId,
    requestKey,
    value: { clientRequestId },
  };
}

test("same payload in another tab adopts the existing credential", () => {
  const winner = turn("text", "user:1", "conversation:1", "payload:1", "request:a");
  const contender = turn("text", "user:1", "conversation:1", "payload:1", "request:b");

  const decision = arbitratePendingTurn([winner], contender);

  assert.equal(decision.status, "existing");
  assert.equal(decision.turn.value.clientRequestId, "request:a");
});

test("one owner and conversation cannot hold simultaneous media and text turns", () => {
  const winner = turn("media", "user:1", "conversation:1", "image:1", "request:media");
  const contender = turn("text", "user:1", "conversation:1", "text:1", "request:text");

  const decision = arbitratePendingTurn([winner], contender);

  assert.equal(decision.status, "existing");
  assert.equal(decision.turn.kind, "media");
  assert.equal(decision.turn.value.clientRequestId, "request:media");
});

test("a different payload cannot replace the conversation winner", () => {
  const winner = turn("text", "user:1", "conversation:1", "payload:1", "request:a");
  const contender = turn("text", "user:1", "conversation:1", "payload:2", "request:b");

  const decision = arbitratePendingTurn([winner], contender);

  assert.equal(decision.status, "existing");
  assert.equal(decision.turn.requestKey, "payload:1");
});

test("different conversations and owners may insert independently", () => {
  const existing = [turn("text", "user:1", "conversation:1", "payload:1", "request:a")];
  const otherConversation = turn("media", "user:1", "conversation:2", "image:1", "request:b");
  const otherOwner = turn("text", "user:2", "conversation:1", "payload:2", "request:c");

  assert.equal(arbitratePendingTurn(existing, otherConversation).status, "inserted");
  assert.equal(arbitratePendingTurn(existing, otherOwner).status, "inserted");
});

test("a losing tab cannot delete the winning credential", () => {
  const winner = turn("text", "user:1", "conversation:1", "payload:1", "request:a");
  const loser = turn("text", "user:1", "conversation:1", "payload:1", "request:b");
  const owns = (row: PendingTurnDescriptor<Row>, expected: PendingTurnDescriptor<Row>) =>
    row.value.clientRequestId === expected.value.clientRequestId;

  assert.deepEqual(removePendingTurnIfOwned([winner], loser, owns), [winner]);
  assert.deepEqual(removePendingTurnIfOwned([winner], winner, owns), []);
});
