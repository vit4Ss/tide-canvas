import assert from "node:assert/strict";
import test from "node:test";
import { useCanvasStore } from "./use-canvas-store.ts";

const nodes = [
  { id: "a", type: "image", x: 0, y: 0, width: 100, height: 100, title: "A" },
  { id: "b", type: "image", x: 200, y: 0, width: 100, height: 100, title: "B" },
];
const connections = [{ id: "ab", sourceId: "a", targetId: "b" }];

test("node and connection selections stay mutually exclusive", () => {
  const store = useCanvasStore.getState();
  store.loadCanvas(nodes, connections);

  store.selectConnection("ab");
  assert.equal(useCanvasStore.getState().selectedConnectionId, "ab");
  assert.deepEqual([...useCanvasStore.getState().selectedNodeIds], []);

  store.selectNode("a");
  assert.equal(useCanvasStore.getState().selectedConnectionId, null);
  assert.deepEqual([...useCanvasStore.getState().selectedNodeIds], ["a"]);

  store.selectConnection("ab");
  assert.equal(useCanvasStore.getState().selectedConnectionId, "ab");
  assert.deepEqual([...useCanvasStore.getState().selectedNodeIds], []);

  store.clearSelection();
  assert.equal(useCanvasStore.getState().selectedConnectionId, null);
});
