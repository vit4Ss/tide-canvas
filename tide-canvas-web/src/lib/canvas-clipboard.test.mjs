import assert from "node:assert/strict";
import test from "node:test";
import { captureCanvasNodeClipboard, materializeCanvasNodeClipboard } from "./canvas-clipboard.ts";

const source = { id: "source", type: "video", x: 0, y: 0, width: 100, height: 80, title: "源" };
const reshoot = {
  id: "reshoot",
  type: "video",
  x: 200,
  y: 100,
  width: 100,
  height: 80,
  title: "片段重拍",
  videoOperation: "clip_reshoot",
  clipReshootSourceId: "source",
};

test("pasting a derived node preserves its surviving incoming references", () => {
  const snapshot = captureCanvasNodeClipboard(reshoot, [
    { id: "source-reshoot", sourceId: "source", targetId: "reshoot", targetSlot: "video" },
  ]);
  const pasted = materializeCanvasNodeClipboard({
    snapshot,
    newNodeId: "copy",
    availableNodeIds: new Set([source.id, reshoot.id]),
  });
  assert.equal(pasted.node.id, "copy");
  assert.equal(pasted.node.x, 230);
  assert.deepEqual(pasted.connections, [{
    id: "conn_copy_copy_0",
    sourceId: "source",
    targetId: "copy",
    targetSlot: "video",
  }]);
});

test("pasting drops references whose source node no longer exists", () => {
  const snapshot = captureCanvasNodeClipboard(reshoot, [
    { id: "source-reshoot", sourceId: "source", targetId: "reshoot" },
  ]);
  const pasted = materializeCanvasNodeClipboard({
    snapshot,
    newNodeId: "copy",
    availableNodeIds: new Set([reshoot.id]),
    worldX: 500,
    worldY: 400,
  });
  assert.equal(pasted.node.x, 450);
  assert.equal(pasted.node.y, 360);
  assert.deepEqual(pasted.connections, []);
});
