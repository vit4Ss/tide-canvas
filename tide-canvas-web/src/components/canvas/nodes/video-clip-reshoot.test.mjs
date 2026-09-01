import assert from "node:assert/strict";
import test from "node:test";
import {
  addClipReshootRange,
  buildClipReshootRangeInstruction,
  buildClipReshootNode,
  buildNativeClipReshootInstruction,
  clipReshootProviderDuration,
  extractClipReshootRanges,
  formatClipReshootTime,
  normalizeClipReshootRanges,
  remapClipReshootPromptTimecodes,
  resizeClipReshootRange,
  selectClipReshootModel,
  supportsTimestampVideoEdit,
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
  assert.deepEqual(first.generationConfig, { modelId: "omni", resolution: "1080P", duration: 5 });

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
  assert.equal(result.generationConfig.duration, 5);
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
  assert.ok(
    buildClipReshootRangeInstruction([{ start: 0, end: 5 }], 6)
      .startsWith("重拍参考视频中的全部画面。该参考视频已按时间轴裁出选中片段；输出仅包含这些片段，并按参考视频顺序连续生成。"),
  );
  assert.ok(
    buildClipReshootRangeInstruction([{ start: 0, end: 5 }], 6, "视频2").startsWith("重拍视频2中的全部画面。"),
  );
  assert.equal(clipReshootProviderDuration([{ start: 4, end: 7 }], 11), 3);
  assert.equal(clipReshootProviderDuration([{ start: 1, end: 2.2 }, { start: 8, end: 9.1 }], 11), 3);
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

test("aspect-ratio text like 16:9到9:16 is not mistaken for a timecode range", () => {
  // 画幅比例与时间码同形:两端都是裸 M:S 且都超过原片时长+60s → 按普通文本放行。
  assert.equal(validateClipReshootPrompt("把画幅从16:9到9:16", 6), null);
  assert.equal(validateClipReshootPrompt("竖屏改横屏 9:16到16:9", 6), null);
  assert.deepEqual(extractClipReshootRanges("画幅 16:9到9:16", 6), []);
  // 重映射同样原样放行(顺序递增的 9:16到16:9 曾被误判为"落在缝隙里")。
  assert.deepEqual(
    remapClipReshootPromptTimecodes("画幅从9:16到16:9", [{ start: 3, end: 7 }], 10),
    { prompt: "画幅从9:16到16:9" },
  );
  // 倒序画幅(16:9到9:16)先过同形判别再查顺序:按普通文本放行,不报"顺序错误"。
  assert.deepEqual(
    remapClipReshootPromptTimecodes("把画幅从16:9到9:16", [{ start: 3, end: 7 }], 10),
    { prompt: "把画幅从16:9到9:16" },
  );
  // 真实时间码的顺序错误由 remap 持原片时长语境直接报出:长片(180s)选 10s 区间,
  // 倒序 2:30到2:10 若漏到下游 validate,会因选区总长阈值被误判成画幅文本而静默放行。
  assert.equal(
    remapClipReshootPromptTimecodes("画面从2:30到2:10 倒放", [{ start: 100, end: 110 }], 180)
      .error?.includes("结束时间必须晚于开始时间"),
    true,
  );
  assert.equal(
    remapClipReshootPromptTimecodes("0:06-0:04 倒序", [{ start: 3, end: 7 }], 10)
      .error?.includes("结束时间必须晚于开始时间"),
    true,
  );
  // 与真实时间码共存:时间码照常重映射,画幅文本不动。
  const mixed = remapClipReshootPromptTimecodes("0:04-0:06 转场,画幅 9:16到16:9", [{ start: 3, end: 7 }], 10);
  assert.equal(mixed.prompt, "00:01-00:03 转场,画幅 9:16到16:9");
  // 判别依赖时长兜底:接近时长的越界时间码仍按时间码报错,不被误放行。
  assert.equal(validateClipReshootPrompt("00:00-00:07 too long", 6)?.includes("超出原视频"), true);
  // 小时格式(0:01:30)不是画幅形态,仍走时间码语义。
  assert.equal(validateClipReshootPrompt("0:01:30-0:01:40 后段", 6)?.includes("超出原视频"), true);
});

test("clip reshoot instruction pins seam frames and effective duration", () => {
  const base = buildClipReshootRangeInstruction([{ start: 2, end: 5 }], 10, "视频1");
  // 首尾帧锚定始终存在:裁剪片段的首尾帧就是与原片的两个接缝画面。
  assert.ok(base.includes("第一帧"));
  assert.ok(base.includes("最后一帧"));
  assert.ok(base.includes("无缝衔接"));
  // 生成档位与选区等长:不需要有效时长提示。
  assert.ok(!base.includes("秒内完整呈现"));
  // 3 秒选区被吸附到 5 秒档:必须告知模型只有前 3.0 秒会被保留。
  const snapped = buildClipReshootRangeInstruction([{ start: 2, end: 5 }], 10, "视频1", 5);
  assert.ok(snapped.includes("前 3.0 秒内完整呈现"));
});

test("clip reshoot native instruction keeps original-timeline timecodes", () => {
  const instruction = buildNativeClipReshootInstruction(
    [{ start: 3, end: 7 }, { start: 10, end: 12 }],
    20,
    "视频1",
  );
  assert.ok(instruction.includes("00:03-00:07"));
  assert.ok(instruction.includes("00:10-00:12"));
  assert.ok(instruction.includes("仅重新生成视频1"));
  assert.ok(instruction.includes("保持完全不变"));
  assert.ok(instruction.includes("等长的完整视频"));
  // 「修改要求:」标签由调用方在用户提示词非空时追加,指令本体不带悬空标签。
  assert.ok(!instruction.includes("修改要求"));
});

test("timestamp video edit capability is a strict opt-in on top of video reference", () => {
  const base = { id: "1", modelId: "m", name: "M", icon: "", type: "video", pointCost: 1 };
  assert.equal(supportsTimestampVideoEdit({ ...base, config: "{}" }), false);
  assert.equal(supportsTimestampVideoEdit({ ...base, config: JSON.stringify({ timestampVideoEdit: true }) }), true);
  // 字符串 "true" 等松散值不算:必须是布尔 true。
  assert.equal(supportsTimestampVideoEdit({ ...base, config: JSON.stringify({ timestampVideoEdit: "true" }) }), false);
  // 视频参考被关掉的模型即使带标记也不可用(原生路径依赖全片作为视频参考下发)。
  assert.equal(
    supportsTimestampVideoEdit({
      ...base,
      config: JSON.stringify({ timestampVideoEdit: true, omniRefVideoEnabled: false }),
    }),
    false,
  );
  assert.equal(supportsTimestampVideoEdit({ ...base, config: "not-json" }), false);
});

test("clip reshoot remaps original-timeline prompt timecodes into the clipped timeline", () => {
  // 选区 3-7 秒:原片 0:04-0:06 在裁剪片段里是 00:01-00:03。
  const single = remapClipReshootPromptTimecodes("0:04-0:06 把伞改成透明", [{ start: 3, end: 7 }], 10);
  assert.equal(single.prompt, "00:01-00:03 把伞改成透明");
  // 跨越两个选区(缝隙被拼接移除):3-7 与 10-12 选区,0:05-0:11 → 00:02-00:05。
  const spanning = remapClipReshootPromptTimecodes(
    "0:05-0:11 加快节奏",
    [{ start: 3, end: 7 }, { start: 10, end: 12 }],
    20,
  );
  assert.equal(spanning.prompt, "00:02-00:05 加快节奏");
  // 端点落在缝隙(8 秒不在任何选区)→ 明确报错。
  const gapped = remapClipReshootPromptTimecodes("0:08-0:11 改颜色", [{ start: 3, end: 7 }, { start: 10, end: 12 }], 20);
  assert.ok(gapped.error?.includes("不在时间轴选中的重拍片段内"));
  // 没写时间码:原样通过。
  assert.deepEqual(
    remapClipReshootPromptTimecodes("把瞳孔改成红色", [{ start: 3, end: 7 }], 10),
    { prompt: "把瞳孔改成红色" },
  );
});
