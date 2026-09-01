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

test("copying strips volatile blob media so pasted clones never hold dead links", () => {
  // blob: 是上传中的本地临时地址,原节点上传完成后 revoke——克隆体拿不到回写,
  // 快照必须剥掉,粘贴出诚实的空内容而不是几秒后必然破图的节点。
  const uploading = {
    id: "up",
    type: "image",
    x: 0,
    y: 0,
    width: 100,
    height: 80,
    imageSrc: "blob:http://localhost/abc",
    images: ["blob:http://localhost/abc", "https://cdn.example.com/kept.png"],
    audioTracks: [{ url: "blob:http://localhost/track" }],
  };
  const snapshot = captureCanvasNodeClipboard(uploading, []);
  assert.equal(snapshot.node.imageSrc, undefined);
  assert.deepEqual(snapshot.node.images, ["https://cdn.example.com/kept.png"]);
  assert.equal(snapshot.node.audioTracks, undefined);
  // 远端地址原样保留,不受剥离影响。
  const settled = { ...uploading, imageSrc: "https://cdn.example.com/a.png", images: undefined, audioTracks: undefined };
  assert.equal(captureCanvasNodeClipboard(settled, []).node.imageSrc, "https://cdn.example.com/a.png");
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
