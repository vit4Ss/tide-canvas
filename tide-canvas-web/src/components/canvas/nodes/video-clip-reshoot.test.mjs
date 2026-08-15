import assert from "node:assert/strict";
import test from "node:test";
import {
  buildClipReshootNode,
  extractClipReshootRanges,
  selectClipReshootModel,
  supportsVideoReference,
  validateClipReshootPrompt,
} from "./video-clip-reshoot.ts";

const unrestrictedModel = {
  id: "1",
  modelId: "omni",
  name: "Omni",
  icon: "",
  type: "video",
  config: "{}",
  pointCost: 1,
};

test("clip reshoot selects a reference-capable model", () => {
  const textOnly = {
    ...unrestrictedModel,
    id: "2",
    modelId: "text-only",
    supportedHandlers: ["text_to_video"],
  };
  assert.equal(supportsVideoReference(textOnly), false);
  assert.equal(supportsVideoReference(unrestrictedModel), true);
  assert.equal(selectClipReshootModel([textOnly, unrestrictedModel], "text-only")?.modelId, "omni");
});

test("clip reshoot keeps source settings and does not repeat the title suffix", () => {
  const source = {
    id: "source",
    type: "video",
    x: 0,
    y: 0,
    width: 608,
    height: 342,
    contentW: 608,
    contentH: 342,
    title: "镜头 1",
    aspectRatio: "16:9",
    generationConfig: { modelId: "old", resolution: "1080P", duration: 8 },
    status: "success",
  };
  const first = buildClipReshootNode({
    source,
    id: "first",
    x: 688,
    y: 0,
    modelId: "omni",
    ratio: "1:1",
    resolution: "720P",
    duration: 5,
  });
  assert.equal(first.title, "镜头 1 · 片段重拍");
  assert.equal(first.videoOperation, "clip_reshoot");
  assert.deepEqual(first.generationConfig, { modelId: "omni", resolution: "1080P", duration: 8 });

  const repeated = buildClipReshootNode({
    source: first,
    id: "second",
    x: 1376,
    y: 0,
    modelId: "omni",
    ratio: "16:9",
    resolution: "720P",
    duration: 5,
  });
  assert.equal(repeated.title, "镜头 1 · 片段重拍");
  assert.equal(repeated.videoOperation, "clip_reshoot");
});

test("clip reshoot prefers actual media metadata for uploaded videos", () => {
  const result = buildClipReshootNode({
    source: {
      id: "source",
      type: "video",
      x: 0,
      y: 0,
      width: 608,
      height: 342,
      title: "uploaded",
      mediaDuration: 6.4,
      mediaWidth: 1920,
      mediaHeight: 1080,
    },
    id: "derived",
    x: 700,
    y: 0,
    modelId: "omni",
    ratio: "1:1",
    resolution: "720P",
    duration: 5,
  });
  assert.equal(result.aspectRatio, "16:9");
  assert.equal(result.generationConfig.duration, 6);
});

test("clip reshoot validates structured time ranges against source duration", () => {
  assert.deepEqual(extractClipReshootRanges("00:00–00:04 red\n00:03 到 00:06 blue").map((item) => [item.start, item.end]), [[0, 4], [3, 6]]);
  assert.equal(validateClipReshootPrompt("red eyes only", 6), null);
  assert.equal(validateClipReshootPrompt("00:03-00:02 reverse", 6)?.includes("结束时间"), true);
  assert.equal(validateClipReshootPrompt("00:00-00:07 too long", 6)?.includes("超出原视频"), true);
  assert.equal(validateClipReshootPrompt("00:60-01:10 invalid", 80)?.includes("格式无效"), true);
});
