import assert from "node:assert/strict";
import test from "node:test";
import { canvasConnectionRule } from "./canvas-connection-rules.ts";

const allowed = (source, target) => canvasConnectionRule({ type: source }, { type: target }).allowed;

test("video breakdown accepts video input", () => {
  assert.deepEqual(canvasConnectionRule({ type: "video" }, { type: "video_breakdown" }), { allowed: true });
});

test("video breakdown rejects non-video input with a user-facing reason", () => {
  assert.deepEqual(canvasConnectionRule({ type: "audio" }, { type: "video_breakdown" }), {
    allowed: false,
    reason: "逐帧拉片仅支持连接视频节点",
  });
  assert.equal(allowed("image", "video_breakdown"), false);
});

// 图片族只消费图片族/导演台/文本/风格引用——视频与音频从连线层拒绝
// (2026-08 用户定稿),不再出现「连上了却被静默忽略/混进 imageList」的死连线。
test("image-family nodes reject video and audio sources", () => {
  for (const target of ["image", "character", "scene"]) {
    const video = canvasConnectionRule({ type: "video" }, { type: target });
    assert.equal(video.allowed, false);
    assert.match(video.reason ?? "", /截取画面帧/);
    assert.equal(allowed("audio", target), false);
  }
});

test("image-family nodes keep their real reference sources", () => {
  for (const source of ["image", "character", "scene", "scene_3d", "text", "style_reference"]) {
    assert.equal(allowed(source, "image"), true, source);
  }
});

test("video node accepts omni-reference kinds but not style or 3d sources", () => {
  for (const source of ["image", "character", "scene", "scene_3d", "video", "audio", "text"]) {
    assert.equal(allowed(source, "video"), true, source);
  }
  assert.equal(allowed("style_reference", "video"), false);
  assert.equal(allowed("3d", "video"), false);
  assert.equal(allowed("video_breakdown", "video"), false);
});

test("3d node only takes image-bearing references", () => {
  for (const source of ["image", "character", "scene", "scene_3d"]) {
    assert.equal(allowed(source, "3d"), true, source);
  }
  for (const source of ["video", "audio", "text"]) {
    assert.equal(allowed(source, "3d"), false, source);
  }
});

// scene_3d 的组件明确排除角色节点与视频源;白模来自 3d 节点。
test("scene_3d accepts pano images and 3d assets only", () => {
  for (const source of ["image", "scene", "3d"]) {
    assert.equal(allowed(source, "scene_3d"), true, source);
  }
  for (const source of ["character", "video", "audio", "text"]) {
    assert.equal(allowed(source, "scene_3d"), false, source);
  }
});

test("sink-less nodes reject every incoming connection with a fixed reason", () => {
  assert.deepEqual(canvasConnectionRule({ type: "image" }, { type: "audio" }), {
    allowed: false,
    reason: "音频节点暂不支持输入连线",
  });
  assert.equal(allowed("image", "text"), false);
  assert.equal(allowed("image", "script"), false);
  assert.equal(allowed("video", "video_compose"), false);
  assert.equal(allowed("image", "style_reference"), false);
});

// script 的剧本没有任何下游消费(inlineIncomingTextRefs 只认 text 与角色/场景),
// 连出去也是死连线;拒绝文案必须显示中文名而不是原始 type。
test("script node is rejected as a source with a localized reason", () => {
  const rule = canvasConnectionRule({ type: "script" }, { type: "image" });
  assert.equal(rule.allowed, false);
  assert.match(rule.reason ?? "", /脚本/);
  assert.doesNotMatch(rule.reason ?? "", /script/);
  assert.equal(allowed("script", "video"), false);
});

// 未登记的目标类型保持放行:新节点类型接入入边消费逻辑前不误拦。
test("unknown target types stay permissive", () => {
  assert.equal(allowed("video_breakdown", "future_node"), true);
  assert.equal(allowed("anything", "group"), true);
});
