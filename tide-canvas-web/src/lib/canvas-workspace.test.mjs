import assert from "node:assert/strict";
import test from "node:test";
import { initialCanvasWorkspace, parseCanvasWorkspace, captureWorkspaceCanvas, serializeCanvasWorkspace, createWorkspaceCanvasId, renameWorkspaceCanvas, copyWorkspaceCanvas, deleteWorkspaceCanvas, workspaceCanvasHref } from "./canvas-document.ts";

const graph = (id) => ({ nodes: [{ id, type: "image", imageSrc: `https://example.com/${id}.png` }], connections: [], groups: [] });
const identity = (node) => node;

test("canvas creation works on LAN HTTP without crypto.randomUUID", () => {
  const first = createWorkspaceCanvasId(null);
  const second = createWorkspaceCanvasId(null);
  assert.match(first, /^canvas-[0-9]+-[a-z0-9]+$/);
  assert.notEqual(first, second);
  assert.equal(createWorkspaceCanvasId(() => "secure-id"), "secure-id");
});

test("legacy projects preserve their graph as the first named canvas", () => {
  const original = graph("existing");
  const workspace = parseCanvasWorkspace(JSON.stringify(original));
  assert.equal(workspace.canvases.length, 1);
  assert.equal(workspace.canvases[0].name, "画布 1");
  assert.deepEqual(workspace.canvases[0].document, original);
});

test("workspace roundtrip retains inactive canvases, names, views and viewports", () => {
  const workspace = initialCanvasWorkspace(graph("first"));
  workspace.canvases.push({ id: "second", name: "第二幕", document: graph("second"), viewport: { x: 55, y: -20, k: 0.7 }, viewMode: "storyboard" });
  workspace.activeCanvasId = "second";
  const serialized = serializeCanvasWorkspace(workspace, identity);
  assert.deepEqual(parseCanvasWorkspace(serialized), workspace);
  assert.equal(JSON.parse(serialized).nodes[0].id, "second");
});

test("capturing current edits never changes the inactive canvas", () => {
  const workspace = initialCanvasWorkspace(graph("first"));
  workspace.canvases.push({ ...workspace.canvases[0], id: "second", name: "画布 2", document: graph("second") });
  const updated = captureWorkspaceCanvas(workspace, graph("new-edit"), { x: 2, y: 3, k: 1.5 }, "storyboard");
  assert.equal(updated.canvases[0].document.nodes[0].id, "new-edit");
  assert.deepEqual(updated.canvases[1], workspace.canvases[1]);
  assert.equal(workspace.canvases[0].document.nodes[0].id, "first");
});

test("every canvas is sanitized before save including inactive uploads", () => {
  const workspace = initialCanvasWorkspace(graph("first"));
  workspace.canvases[0].document.nodes[0].imageSrc = "blob:temporary";
  workspace.canvases.push({ ...workspace.canvases[0], id: "second", document: graph("second") });
  workspace.activeCanvasId = "second";
  const saved = JSON.parse(serializeCanvasWorkspace(workspace, (node) => ({ ...node, imageSrc: node.imageSrc?.startsWith("blob:") ? undefined : node.imageSrc })));
  assert.equal(saved.workspace.canvases[0].document.nodes[0].imageSrc, undefined);
  assert.match(workspace.canvases[0].document.nodes[0].imageSrc, /^blob:/);
});

test("malformed inactive canvases are rejected instead of being overwritten", () => {
  const workspace = initialCanvasWorkspace(graph("first"));
  workspace.canvases.push({ ...workspace.canvases[0], id: "broken", document: { nodes: "bad" } });
  assert.throws(() => parseCanvasWorkspace(JSON.stringify({ nodes: [], workspace })));
});

test("duplicate canvas ids, missing active canvases and unknown versions fail safely", () => {
  const workspace = initialCanvasWorkspace();
  for (const invalid of [
    { ...workspace, version: 2 },
    { ...workspace, activeCanvasId: "missing" },
    { ...workspace, canvases: [] },
    { ...workspace, canvases: [...workspace.canvases, workspace.canvases[0]] },
  ]) assert.throws(() => parseCanvasWorkspace(JSON.stringify({ nodes: [], workspace: invalid })));
});

test("invalid viewports cannot restore a corrupted canvas transform", () => {
  for (const viewport of [{ x: 0, y: 0, k: 0 }, { x: null, y: 0, k: 1 }, { x: 0, y: 0, k: 10 }]) {
    const workspace = initialCanvasWorkspace();
    workspace.canvases[0].viewport = viewport;
    assert.throws(() => parseCanvasWorkspace(JSON.stringify({ nodes: [], workspace })));
  }
});

test("renaming trims the name without changing graphs or the active canvas", () => {
  const workspace = initialCanvasWorkspace(graph("original"));
  const updated = renameWorkspaceCanvas(workspace, "canvas-1", "  分镜设计  ");
  assert.equal(updated.canvases[0].name, "分镜设计");
  assert.equal(workspace.canvases[0].name, "画布 1");
  assert.equal(updated.canvases[0].document, workspace.canvases[0].document);
  assert.equal(updated.activeCanvasId, workspace.activeCanvasId);
  assert.throws(() => renameWorkspaceCanvas(workspace, "canvas-1", "  "));
  assert.throws(() => renameWorkspaceCanvas(workspace, "missing", "名字"));
});

test("copying creates an independent graph with remapped references and no live tasks", () => {
  const workspace = initialCanvasWorkspace({
    nodes: [
      { id: "video", type: "video", status: "generating", videoSrc: "https://example.com/video.mp4", taskId: "task", pendingGeneration: { input: {} }, skillRunId: "run", generationConfig: { modelId: "model" } },
      { id: "frame", type: "image", status: "generating", uploading: true, uploadProgress: 20, clipReshootSourceId: "video", storyboardFrame: { sourceVideoId: "video", timeSec: 1, index: 0 } },
    ],
    connections: [{ id: "edge", sourceId: "video", targetId: "frame", targetSlot: "reference" }],
    groups: [{ id: "group", title: "场景", color: "#ffffff", nodeIds: ["video", "frame"] }],
  });
  const original = structuredClone(workspace);
  const copied = copyWorkspaceCanvas(workspace, "canvas-1", "copy");
  const copy = copied.canvases[1];
  assert.equal(copied.activeCanvasId, "copy");
  assert.equal(copy.name, "画布 1 副本");
  assert.deepEqual(copy.document.nodes.map((node) => node.id), ["copy:node:0", "copy:node:1"]);
  assert.equal(copy.document.connections[0].sourceId, "copy:node:0");
  assert.equal(copy.document.connections[0].targetId, "copy:node:1");
  assert.equal(copy.document.connections[0].targetSlot, "reference");
  assert.deepEqual(copy.document.groups[0].nodeIds, ["copy:node:0", "copy:node:1"]);
  assert.notEqual(copy.document.groups[0].id, "group");
  assert.equal(copy.document.nodes[1].clipReshootSourceId, "copy:node:0");
  assert.equal(copy.document.nodes[1].storyboardFrame.sourceVideoId, "copy:node:0");
  assert.equal(copy.document.nodes[0].status, "success");
  assert.equal(copy.document.nodes[1].status, "idle");
  for (const node of copy.document.nodes) for (const key of ["taskId", "pendingGeneration", "skillRunId", "uploading", "uploadProgress"]) assert.equal(node[key], undefined);
  copy.document.nodes[0].generationConfig.modelId = "changed";
  copy.document.groups[0].title = "changed";
  assert.deepEqual(workspace, original);
  assert.equal(copyWorkspaceCanvas(copied, "canvas-1", "copy-2").canvases[1].name, "画布 1 副本 2");
  assert.throws(() => copyWorkspaceCanvas(workspace, "missing", "new"));
  assert.throws(() => copyWorkspaceCanvas(workspace, "canvas-1", "canvas-1"));
});

test("deleting selects a surviving neighbor and refuses to remove the last canvas", () => {
  let workspace = initialCanvasWorkspace(graph("original"));
  workspace = copyWorkspaceCanvas(workspace, "canvas-1", "second");
  workspace = copyWorkspaceCanvas(workspace, "second", "third");
  const original = structuredClone(workspace);
  const inactiveDeleted = deleteWorkspaceCanvas(workspace, "canvas-1");
  assert.equal(inactiveDeleted.activeCanvasId, "third");
  assert.deepEqual(inactiveDeleted.canvases.map((canvas) => canvas.id), ["second", "third"]);
  assert.equal(deleteWorkspaceCanvas(workspace, "third").activeCanvasId, "second");
  assert.equal(deleteWorkspaceCanvas({ ...workspace, activeCanvasId: "canvas-1" }, "canvas-1").activeCanvasId, "second");
  assert.deepEqual(workspace, original);
  assert.throws(() => deleteWorkspaceCanvas(initialCanvasWorkspace(), "canvas-1"));
  assert.throws(() => deleteWorkspaceCanvas(workspace, "missing"));
});

test("new window links preserve the requested canvas identity", () => {
  const href = workspaceCanvasHref("project/1", "画布&2");
  const url = new URL(href, "https://canvas.example");
  assert.equal(url.pathname, "/canvas/project%2F1");
  assert.equal(url.searchParams.get("canvas"), "画布&2");
});
