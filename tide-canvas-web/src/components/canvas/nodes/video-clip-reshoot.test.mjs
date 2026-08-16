import assert from "node:assert/strict";
import test from "node:test";
import {
  addClipReshootRange,
  buildClipReshootRangeInstruction,
  buildClipReshootNode,
  extractClipReshootRanges,
  formatClipReshootTime,
  normalizeClipReshootRanges,
  resizeClipReshootRange,
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

test("clip reshoot excludes models whose omni video reference is disabled", () => {
  const videoDisabled = {
    ...unrestrictedModel,
    id: "3",
    modelId: "image-ref-only",
    supportedHandlers: ["reference_to_video"],
    config: JSON.stringify({ omniRefImageEnabled: true, omniRefVideoEnabled: false }),
  };
  assert.equal(supportsVideoReference(videoDisabled), false);
  assert.equal(selectClipReshootModel([videoDisabled, unrestrictedModel], "image-ref-only")?.modelId, "omni");
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
  assert.equal(first.clipReshootSourceId, "source");
  assert.deepEqual(first.clipReshootRanges, [{ start: 0, end: 5 }]);
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
  assert.equal(repeated.clipReshootSourceId, "first");
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
  assert.deepEqual(result.clipReshootRanges, [{ start: 0, end: 5 }]);
});

test("clip reshoot normalizes and formats visual timeline ranges", () => {
  assert.deepEqual(normalizeClipReshootRanges(undefined, 3.2), [{ start: 0, end: 3.2 }]);
  assert.deepEqual(normalizeClipReshootRanges([
    { start: 5, end: 8 },
    { start: -1, end: 2 },
    { start: 4, end: 3 },
  ], 6), [{ start: 0, end: 2 }, { start: 5, end: 6 }]);
  assert.deepEqual(normalizeClipReshootRanges([
    { start: 0, end: 4 },
    { start: 3, end: 6 },
  ], 6), [{ start: 0, end: 4 }, { start: 4, end: 6 }]);
  assert.equal(formatClipReshootTime(65.4), "01:05.4");
  assert.equal(formatClipReshootTime(59.96), "01:00");
  assert.equal(
    buildClipReshootRangeInstruction([{ start: 0, end: 5 }], 6),
    "仅重拍参考视频中的以下片段：00:00–00:05。未选中的画面保持不变。",
  );
  assert.equal(
    buildClipReshootRangeInstruction([{ start: 0, end: 5 }], 6, "视频2"),
    "仅重拍视频2中的以下片段：00:00–00:05。未选中的画面保持不变。",
  );
});

test("clip reshoot timeline adds only inside free gaps and keeps ranges apart", () => {
  const added = addClipReshootRange([{ start: 0, end: 5 }], 6, 5.5);
  assert.equal(added.changed, true);
  assert.equal(added.activeIndex, 1);
  assert.deepEqual(added.ranges, [{ start: 0, end: 5 }, { start: 5, end: 6 }]);

  const activated = addClipReshootRange(added.ranges, 6, 2);
  assert.equal(activated.changed, false);
  assert.equal(activated.activeIndex, 0);

  assert.deepEqual(
    resizeClipReshootRange(added.ranges, 6, 0, "end", 5.8),
    [{ start: 0, end: 5 }, { start: 5, end: 6 }],
  );
  assert.deepEqual(
    resizeClipReshootRange(added.ranges, 6, 1, "start", 5.8),
    [{ start: 0, end: 5 }, { start: 5.5, end: 6 }],
  );

  const full = Array.from({ length: 5 }, (_, index) => ({ start: index, end: index + 0.5 }));
  assert.deepEqual(addClipReshootRange(full, 6, 5.5), {
    ranges: full,
    activeIndex: -1,
    changed: false,
  });
});

test("clip reshoot validates structured time ranges against source duration", () => {
  assert.deepEqual(extractClipReshootRanges("00:00–00:04 red\n00:03 到 00:06 blue").map((item) => [item.start, item.end]), [[0, 4], [3, 6]]);
  assert.equal(validateClipReshootPrompt("red eyes only", 6), null);
  assert.equal(validateClipReshootPrompt("00:03-00:02 reverse", 6)?.includes("结束时间"), true);
  assert.equal(validateClipReshootPrompt("00:00-00:07 too long", 6)?.includes("超出原视频"), true);
  assert.equal(validateClipReshootPrompt("00:60-01:10 invalid", 80)?.includes("格式无效"), true);
});
