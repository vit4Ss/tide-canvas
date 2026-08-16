import assert from "node:assert/strict";
import test from "node:test";
import { useCanvasStore } from "./use-canvas-store.ts";

test("nodes, connections and generated groups land in one undoable transaction", () => {
  useCanvasStore.getState().clearCanvas();
  useCanvasStore.getState().addNodesAndConnections(
    [
      { id: "processor", type: "video_breakdown", x: 0, y: 0, width: 360, height: 264, title: "逐帧拉片" },
      { id: "frame", type: "image", x: 500, y: 0, width: 280, height: 158, title: "S01" },
    ],
    [{ id: "connection", sourceId: "processor", targetId: "frame" }],
    "frame",
    [{ id: "group", title: "分镜组 01", color: "#3b82f6", nodeIds: ["frame"] }],
  );

  const created = useCanvasStore.getState();
  assert.equal(created.nodes.length, 2);
  assert.equal(created.connections.length, 1);
  assert.deepEqual(created.groups.map((group) => group.nodeIds), [["frame"]]);
  assert.equal(created.selectedNodeId, "frame");
  assert.equal(created.undoStack.length, 1);

  created.undo();
  const undone = useCanvasStore.getState();
  assert.equal(undone.nodes.length, 0);
  assert.equal(undone.connections.length, 0);
  assert.equal(undone.groups.length, 0);
  useCanvasStore.getState().clearCanvas();
});

test("batch insertion cannot attach data to a collided node or duplicate connection ids", () => {
  const store = useCanvasStore.getState();
  store.loadCanvas(
    [{ id: "existing", type: "image", x: 0, y: 0, width: 100, height: 100, title: "原节点" }],
    [],
  );
  store.addNodesAndConnections(
    [
      { id: "existing", type: "image", x: 50, y: 50, width: 100, height: 100, title: "冲突节点" },
      { id: "new", type: "image", x: 200, y: 0, width: 100, height: 100, title: "新节点" },
    ],
    [
      { id: "same", sourceId: "existing", targetId: "new" },
      { id: "same", sourceId: "new", targetId: "existing" },
      { id: "self", sourceId: "new", targetId: "new" },
    ],
  );

  const state = useCanvasStore.getState();
  assert.deepEqual(state.nodes.map((node) => node.title), ["原节点", "新节点"]);
  assert.deepEqual(state.connections, []);
});
