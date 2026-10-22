import assert from "node:assert/strict";
import test from "node:test";
import { planVideoGenerationBatch } from "./video-generation-batch.ts";

const video = (extra = {}) => ({
  id: "video", type: "video", x: 100, y: 80, width: 600, height: 340,
  contentW: 600, contentH: 340, title: "追逐镜头", prompt: "镜头跟随角色", status: "idle",
  generationConfig: { modelId: "old-model", aspectRatio: "16:9", duration: 5, batchCount: 4 },
  ...extra,
});
const image = (id, extra = {}) => ({ id, type: "image", x: -500, y: 0, width: 300, height: 200, title: id, imageSrc: `https://cdn.example/${id}.png`, ...extra });
const edge = (sourceId, targetId, extra = {}) => ({ id: `${sourceId}-${targetId}`, sourceId, targetId, ...extra });
const factory = () => { let n = 0; return () => `batch_${++n}`; };
const rect = (node) => ({ x: node.x + (node.width - (node.contentW ?? node.width)) / 2, y: node.y, w: node.contentW ?? node.width, h: node.contentH ?? node.height });
const overlaps = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

test("a batch reuses an empty idle video once and creates the remaining independent targets", () => {
  const node = video();
  const plan = planVideoGenerationBatch(node, [node], [], 4, { modelId: "new-model", duration: 8 }, factory());
  assert.deepEqual(plan.targetIds, ["video", "batch_1", "batch_2", "batch_3"]);
  assert.equal(plan.newNodes.length, 3);
  assert.ok(plan.newNodes.every((clone) => clone.generationConfig.modelId === "new-model" && clone.generationConfig.duration === 8 && clone.generationConfig.batchCount === 1));
  assert.equal(node.generationConfig.modelId, "old-model");
  assert.equal(node.generationConfig.batchCount, 4);
  assert.deepEqual(planVideoGenerationBatch(node, [node], [], 1, {}, factory()), { targetIds: ["video"], newNodes: [], newConnections: [] });
});

test("regeneration preserves results and failed or active request state on the original", () => {
  for (const state of [{ videoSrc: "https://cdn.example/result.mp4", status: "success" }, { status: "error" }, { status: "generating", taskId: "running" }, { pendingGeneration: { clientRequestId: "pending" } }, { uploading: true }]) {
    const node = video({ ...state, fileSize: 1234, mediaDuration: 7, content: "old output", imageSrc: "poster.png", skillRunId: "skill-run" });
    const before = structuredClone(node);
    const plan = planVideoGenerationBatch(node, [node], [], 2, {}, factory());
    assert.deepEqual(plan.targetIds, ["batch_1", "batch_2"]);
    assert.deepEqual(node, before);
    for (const clone of plan.newNodes) {
      assert.equal(clone.status, "idle");
      for (const key of ["videoSrc", "imageSrc", "fileSize", "mediaDuration", "content", "skillRunId", "taskId", "pendingGeneration", "uploading"]) assert.equal(Object.hasOwn(clone, key), false, key);
    }
  }
});

test("each clone receives incoming references in first/last frame order with unique edge IDs", () => {
  const node = video();
  const nodes = [node, image("first"), image("last")];
  const connections = [edge("last", node.id, { targetSlot: "frame", sourceOutput: "main" }), edge("first", node.id), edge("first", node.id, { id: "duplicate" }), edge("missing", node.id), edge(node.id, node.id), edge("first", "unrelated")];
  const plan = planVideoGenerationBatch(node, nodes, connections, 4, {}, factory());
  assert.equal(plan.newConnections.length, 6);
  for (const clone of plan.newNodes) {
    const copied = plan.newConnections.filter((item) => item.targetId === clone.id);
    assert.deepEqual(copied.map((item) => item.sourceId), ["last", "first"]);
    assert.equal(copied[0].targetSlot, "frame");
    assert.equal(copied[0].sourceOutput, "main");
  }
  assert.equal(new Set([...plan.targetIds, ...plan.newConnections.map((item) => item.id)]).size, 10);
});

test("clip-reshoot configuration is preserved but mutable ranges and batch counts are independent", () => {
  const node = video({ videoSrc: "old.mp4", videoOperation: "clip_reshoot", clipReshootSourceId: "source-video", clipReshootRanges: [{ start: 1, end: 3 }], generationConfig: { modelId: "model", batchCount: 4, threeDMode: "t2", faceCount: 2000 } });
  const plan = planVideoGenerationBatch(node, [node], [], 2, { aspectRatio: "9:16", resolution: "1080p" }, factory());
  const [first, second] = plan.newNodes;
  assert.equal(first.videoOperation, "clip_reshoot");
  assert.equal(first.clipReshootSourceId, "source-video");
  assert.deepEqual(first.clipReshootRanges, [{ start: 1, end: 3 }]);
  assert.equal(first.aspectRatio, "9:16");
  assert.equal(first.generationConfig.batchCount, 1);
  assert.equal(first.generationConfig.threeDMode, undefined);
  assert.equal(first.generationConfig.faceCount, undefined);
  first.clipReshootRanges[0].start = 2;
  first.generationConfig.duration = 10;
  assert.equal(node.clipReshootRanges[0].start, 1);
  assert.equal(second.clipReshootRanges[0].start, 1);
  assert.equal(second.generationConfig.duration, undefined);
});

test("new cards stay in a collision-free right column using actual centered render bounds", () => {
  const node = video({ width: 300, contentW: 600 });
  const blockers = [image("blocker", { x: 700, y: 0, width: 280, contentW: 650, contentH: 600 }), image("lower", { x: 700, y: 900, width: 500, height: 200 })];
  const plan = planVideoGenerationBatch(node, [node, ...blockers], [], 4, {}, factory());
  const source = rect(node);
  for (let index = 0; index < plan.newNodes.length; index += 1) {
    const clone = rect(plan.newNodes[index]);
    assert.equal(clone.x, source.x + source.w + 80);
    for (const obstacle of [node, ...blockers, ...plan.newNodes.slice(0, index)]) assert.equal(overlaps(clone, rect(obstacle)), false);
  }
  assert.equal(plan.newNodes[0].y, 1124);
});

test("invalid counts are rejected and colliding factory IDs cannot merge planned outputs", () => {
  const node = video();
  for (const count of [0, 3, 5, NaN]) assert.throws(() => planVideoGenerationBatch(node, [node], [], count, {}, factory()), RangeError);
  const plan = planVideoGenerationBatch(node, [node], [], 4, {}, () => "video");
  assert.deepEqual(plan.targetIds, ["video", "video_2", "video_3", "video_4"]);
  assert.throws(() => planVideoGenerationBatch(node, [node], [], 2, {}, () => ""), TypeError);
});
