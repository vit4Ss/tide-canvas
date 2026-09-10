import assert from "node:assert/strict";
import test from "node:test";
import {
  isTransientCanvasSaveCode,
  nextCanvasSaveFollowUp,
  reconcileCanvasSave,
  retainCanvasSaveAcknowledgements,
  settleCanvasSaveAcknowledgements,
  rejectCanvasSaveRetryQueueWhenIdle,
} from "./canvas-save-reconcile.ts";

test("lost acknowledgement adopts the committed revision and flushes edits queued in flight", () => {
  const outcome = reconcileCanvasSave(
    { expectedRevision: 7, canvasData: '{"nodes":[{"id":"sent"}]}', thumbnail: "https://cdn/cover.png" },
    { revision: 8, canvasData: '{"nodes":[{"id":"sent"}]}', thumbnail: "https://cdn/cover.png" },
  );

  assert.deepEqual(outcome, { kind: "acknowledged", revision: 8 });
  assert.equal(nextCanvasSaveFollowUp(outcome, true), "immediate");
});

test("an uncommitted or unreachable attempt remains retryable instead of becoming a conflict", () => {
  const attempt = { expectedRevision: 7, canvasData: '{"nodes":[{"id":"sent"}]}' };

  const unchanged = reconcileCanvasSave(attempt, {
    revision: 7,
    canvasData: '{"nodes":[{"id":"old"}]}',
  });
  assert.deepEqual(unchanged, { kind: "retry" });
  assert.equal(nextCanvasSaveFollowUp(unchanged, false), "delayed");
  assert.deepEqual(reconcileCanvasSave(attempt, undefined), { kind: "retry" });
  assert.equal(nextCanvasSaveFollowUp(unchanged, true, false), "none");
  assert.equal(isTransientCanvasSaveCode(0), true);
  assert.equal(isTransientCanvasSaveCode(500), true);
  assert.equal(isTransientCanvasSaveCode(400), false);
});

test("only a higher mismatching snapshot is a real conflict", () => {
  const attempt = {
    expectedRevision: 7,
    canvasData: '{"nodes":[{"id":"sent"}]}',
    thumbnail: "https://cdn/local.png",
  };

  assert.deepEqual(reconcileCanvasSave(attempt, {
    revision: 8,
    canvasData: '{"nodes":[{"id":"other"}]}',
    thumbnail: "https://cdn/local.png",
  }), { kind: "conflict" });
  assert.deepEqual(reconcileCanvasSave(attempt, {
    revision: 8,
    canvasData: attempt.canvasData,
    thumbnail: "https://cdn/other.png",
  }), { kind: "conflict" });
});

test("durability acknowledgements wait for an automatic retry", () => {
  assert.equal(retainCanvasSaveAcknowledgements(false, "delayed"), true);
  assert.equal(retainCanvasSaveAcknowledgements(false, "none"), false);
  assert.equal(retainCanvasSaveAcknowledgements(true, "immediate"), false);

  const calls = [];
  const first = (saved) => calls.push(["first", saved]);
  const later = (saved) => calls.push(["later", saved]);
  const queue = [later];
  settleCanvasSaveAcknowledgements([first], queue, false, "delayed");
  assert.deepEqual(calls, []);
  assert.deepEqual(queue, [first, later]);
  settleCanvasSaveAcknowledgements(queue.splice(0), queue, true, "none");
  assert.deepEqual(calls, [["first", true], ["later", true]]);

  const abandoned = [(saved) => calls.push(["abandoned", saved])];
  rejectCanvasSaveRetryQueueWhenIdle(abandoned, false, "none");
  assert.deepEqual(abandoned, []);
  assert.deepEqual(calls.at(-1), ["abandoned", false]);
});
