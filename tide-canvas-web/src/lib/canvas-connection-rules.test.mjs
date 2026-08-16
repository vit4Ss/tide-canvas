import assert from "node:assert/strict";
import test from "node:test";
import { canvasConnectionRule } from "./canvas-connection-rules.ts";

test("video breakdown accepts video input", () => {
  assert.deepEqual(canvasConnectionRule({ type: "video" }, { type: "video_breakdown" }), { allowed: true });
});

test("video breakdown rejects non-video input with a user-facing reason", () => {
  assert.deepEqual(canvasConnectionRule({ type: "audio" }, { type: "video_breakdown" }), {
    allowed: false,
    reason: "逐帧拉片仅支持连接视频节点",
  });
  assert.equal(canvasConnectionRule({ type: "image" }, { type: "video_breakdown" }).allowed, false);
});

test("other canvas connections retain the existing permissive behavior", () => {
  assert.equal(canvasConnectionRule({ type: "audio" }, { type: "video" }).allowed, true);
  assert.equal(canvasConnectionRule({ type: "video_breakdown" }, { type: "image" }).allowed, true);
});
