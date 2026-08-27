import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node's native TypeScript loader requires the source suffix.
import { referenceCountIssue, referenceCountLimitOf } from "./reference-count.ts";

const omniConfig = {
  refLimits: { "omniRef.imageCount": 9, "omniRef.videoCount": 3, "omniRef.audioCount": 1 },
};

test("全能参考 reads each kind's own configured cap", () => {
  assert.equal(referenceCountLimitOf(omniConfig, "image", "reference_to_video"), 9);
  assert.equal(referenceCountLimitOf(omniConfig, "video", "reference_to_video"), 3);
  assert.equal(referenceCountLimitOf(omniConfig, "audio", "reference_to_video"), 1);
});

test("each mode reads its own configured key and never borrows another's", () => {
  const config = {
    maxRefImages: 4,
    refLimits: { "i2v.imageCount": 1, "keyframe.imageCount": 2, "omniRef.imageCount": 9 },
  };
  assert.equal(referenceCountLimitOf(config, "image", "image_to_image"), 4);
  assert.equal(referenceCountLimitOf(config, "image", "image_to_video"), 1);
  assert.equal(referenceCountLimitOf(config, "image", "start_end_to_video"), 2);
  assert.equal(referenceCountLimitOf(config, "image", "reference_to_video"), 9);
  // 只有全能参考有视频/音频参考位
  assert.equal(referenceCountLimitOf(config, "video", "image_to_video"), undefined);
  assert.equal(referenceCountLimitOf(config, "audio", "image_to_image"), undefined);
  // 文生视频没有参考素材
  assert.equal(referenceCountLimitOf(config, "image", "text_to_video"), undefined);
  // handler 缺省 = 该模式不套用数量配置（首尾帧固定框 / 3D 只配大小）
  assert.equal(referenceCountLimitOf(config, "image", undefined), undefined);
  assert.equal(referenceCountLimitOf(config, "image", ""), undefined);
});

test("0 / missing / malformed config means unlimited", () => {
  assert.equal(referenceCountLimitOf({ refLimits: { "omniRef.imageCount": 0 } }, "image", "reference_to_video"), undefined);
  assert.equal(referenceCountLimitOf({}, "image", "reference_to_video"), undefined);
  assert.equal(referenceCountLimitOf(null, "image", "reference_to_video"), undefined);
  assert.equal(referenceCountLimitOf(undefined, "image", "reference_to_video"), undefined);
  assert.equal(referenceCountLimitOf({ refLimits: [] }, "image", "reference_to_video"), undefined);
  assert.equal(referenceCountLimitOf({ refLimits: "nope" }, "image", "reference_to_video"), undefined);
});

test("string and fractional config values are normalized", () => {
  assert.equal(referenceCountLimitOf({ refLimits: { "omniRef.imageCount": "9" } }, "image", "reference_to_video"), 9);
  assert.equal(referenceCountLimitOf({ refLimits: { "omniRef.imageCount": 9.7 } }, "image", "reference_to_video"), 9);
  assert.equal(referenceCountLimitOf({ refLimits: { "omniRef.imageCount": -1 } }, "image", "reference_to_video"), undefined);
  assert.equal(referenceCountLimitOf({ refLimits: { "omniRef.imageCount": "abc" } }, "image", "reference_to_video"), undefined);
});

test("submit-time recheck reports the first over-limit kind", () => {
  const issue = referenceCountIssue(omniConfig, "reference_to_video", { image: 15, video: 0, audio: 0 });
  assert.match(issue ?? "", /最多支持 9 个参考图片/);
  assert.match(issue ?? "", /当前为 15 个/);
  assert.match(referenceCountIssue(omniConfig, "reference_to_video", { video: 4 }) ?? "", /最多支持 3 个参考视频/);
  assert.match(referenceCountIssue(omniConfig, "reference_to_video", { audio: 2 }) ?? "", /最多支持 1 个参考音频/);
});

test("a batch within every cap passes", () => {
  assert.equal(referenceCountIssue(omniConfig, "reference_to_video", { image: 9, video: 3, audio: 1 }), null);
  assert.equal(referenceCountIssue(omniConfig, "reference_to_video", {}), null);
  assert.equal(referenceCountIssue({}, "reference_to_video", { image: 30 }), null);
  // 模式不套用数量配置时不拦截
  assert.equal(referenceCountIssue(omniConfig, undefined, { image: 30 }), null);
});
