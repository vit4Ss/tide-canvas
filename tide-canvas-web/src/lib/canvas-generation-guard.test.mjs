import assert from "node:assert/strict";
import test from "node:test";
import {
  canCommitCanvasMediaUpload,
  canReplaceCanvasMedia,
  matchesCanvasGeneration,
  pendingGenerationIdentity,
} from "./canvas-generation-guard.ts";

test("provider results only match the exact persisted generation", () => {
  assert.equal(matchesCanvasGeneration({ status: "generating", taskId: "101" }, "101"), true);
  assert.equal(matchesCanvasGeneration({ status: "generating", taskId: "102" }, "101"), false);
  assert.equal(matchesCanvasGeneration({ status: "success", taskId: "101" }, "101"), false);

  const pending = pendingGenerationIdentity("request-a");
  assert.equal(matchesCanvasGeneration({
    status: "generating",
    pendingGeneration: { clientRequestId: "request-a" },
  }, pending), true);
  assert.equal(matchesCanvasGeneration({
    status: "generating",
    pendingGeneration: { clientRequestId: "request-b" },
  }, pending), false);
});

test("manual replacement is blocked by every recoverable or uploading state", () => {
  assert.equal(canReplaceCanvasMedia({ status: "idle" }), true);
  assert.equal(canReplaceCanvasMedia({ status: "success" }), true);
  assert.equal(canReplaceCanvasMedia({ status: "generating" }), false);
  assert.equal(canReplaceCanvasMedia({ status: "idle", taskId: "101" }), false);
  assert.equal(canReplaceCanvasMedia({
    status: "idle",
    pendingGeneration: { clientRequestId: "request-a" },
  }), false);
  assert.equal(canReplaceCanvasMedia({ status: "idle", uploading: true }), false);
  assert.equal(canCommitCanvasMediaUpload({ status: "idle", uploading: true }), true);
  assert.equal(canCommitCanvasMediaUpload({ status: "generating", uploading: true }), false);
});
