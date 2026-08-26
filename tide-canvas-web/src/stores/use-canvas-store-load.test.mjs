import assert from "node:assert/strict";
import test from "node:test";
import { reviveNode, useCanvasStore } from "./use-canvas-store.ts";

const node = (id, extra = {}) => ({
  id,
  type: "image",
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  title: id,
  ...extra,
});

test("canvas loading salvages valid rows and removes unsafe graph references", () => {
  useCanvasStore.getState().loadCanvas(
    [node("a"), null, node("a"), node("bad", { width: -1 }), node("b")],
    [
      null,
      { id: "valid", sourceId: "a", targetId: "b" },
      { id: "duplicate-pair", sourceId: "a", targetId: "b" },
      { id: "orphan", sourceId: "missing", targetId: "b" },
      { id: "self", sourceId: "a", targetId: "a" },
    ],
    [
      null,
      { id: "g1", title: "第一组", color: "not-a-color", nodeIds: ["a", "missing", "a"] },
      { id: "g2", title: "第二组", color: "#ffffff", nodeIds: ["a", "b"] },
      { id: "empty", title: "空组", color: "#ffffff", nodeIds: ["missing"] },
    ],
  );

  const state = useCanvasStore.getState();
  assert.deepEqual(state.nodes.map((item) => item.id), ["a", "b"]);
  assert.deepEqual(state.connections, [{ id: "valid", sourceId: "a", targetId: "b" }]);
  assert.deepEqual(state.groups.map((group) => group.nodeIds), [["a"], ["b"]]);
  assert.equal(state.groups[0].color, "#3b82f6");
});

test("invalid connection and stale group operations do not pollute history", () => {
  const store = useCanvasStore.getState();
  store.loadCanvas([node("a"), node("b")], []);
  store.addConnection({ id: "missing", sourceId: "a", targetId: "missing" });
  store.addConnection({ id: "self", sourceId: "a", targetId: "a" });
  store.removeGroup("missing");
  store.updateGroup("missing", { title: "无效" });
  store.updateNode("missing", { title: "迟到的异步回调" }, true);
  assert.equal(useCanvasStore.getState().connections.length, 0);
  assert.equal(useCanvasStore.getState().undoStack.length, 0);

  store.addConnection({ id: "ab", sourceId: "a", targetId: "b" });
  store.addConnection({ id: "ab-copy", sourceId: "a", targetId: "b" });
  assert.equal(useCanvasStore.getState().connections.length, 1);
  assert.equal(useCanvasStore.getState().undoStack.length, 1);
});

test("3D generation results survive recovery and undo reconciliation", () => {
  const modelAssets = [{ type: "glb", url: "https://cdn.example.com/scene.glb" }];
  const recovered = reviveNode(node("model", {
    type: "3d",
    status: "generating",
    modelSrc: modelAssets[0].url,
    modelPreviewSrc: "https://cdn.example.com/scene.png",
    modelAssets,
  }));
  assert.equal(recovered.status, "success");

  const store = useCanvasStore.getState();
  store.loadCanvas([node("model", { type: "3d", title: "before" })], []);
  store.pushHistory();
  store.updateNode("model", {
    status: "generating",
    taskId: "task-3d",
    modelSrc: modelAssets[0].url,
    modelPreviewSrc: "https://cdn.example.com/scene.png",
    modelAssets,
  });
  store.undo();

  const restored = useCanvasStore.getState().nodes[0];
  assert.equal(restored.status, "generating");
  assert.equal(restored.modelSrc, modelAssets[0].url);
  assert.equal(restored.modelPreviewSrc, "https://cdn.example.com/scene.png");
  assert.deepEqual(restored.modelAssets, modelAssets);
});
