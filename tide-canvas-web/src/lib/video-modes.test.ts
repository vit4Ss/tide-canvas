import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node's native TypeScript loader requires the source suffix.
import { normalizeVideoMode, normalizeVideoModes } from "./video-modes.ts";

test("relay's omni-reference aliases all normalize to omni_ref", () => {
  for (const alias of [
    "omni_ref",
    "omni_reference",
    "multi_ref",
    "multi_reference",
    "reference_image",
    "reference_to_video",
    "subject_reference",
    "Multi-Ref",
    " MULTI REF ",
    "video/reference",
    "some_reference_mode",
  ]) {
    assert.equal(normalizeVideoMode(alias), "omni_ref", `alias ${alias}`);
  }
});

test("the other three modes normalize like the server does", () => {
  assert.equal(normalizeVideoMode("t2v"), "t2v");
  assert.equal(normalizeVideoMode("text_to_video"), "t2v");
  assert.equal(normalizeVideoMode("i2v"), "i2v");
  assert.equal(normalizeVideoMode("first_frame"), "i2v");
  assert.equal(normalizeVideoMode("image2video"), "i2v");
  assert.equal(normalizeVideoMode("keyframe"), "keyframe");
  assert.equal(normalizeVideoMode("first_last_frame"), "keyframe");
  assert.equal(normalizeVideoMode("start-end"), "keyframe");
});

test("unknown / non-string values are dropped", () => {
  for (const value of ["", "   ", "upscale", "lipsync", null, undefined, 7, {}, []]) {
    assert.equal(normalizeVideoMode(value), null);
  }
});

test("multiple sources are merged, de-duplicated and ordered", () => {
  assert.deepEqual(
    normalizeVideoModes(["multi_ref", "t2v"], ["omni_reference", "keyframe"]),
    ["t2v", "keyframe", "omni_ref"],
  );
  assert.deepEqual(normalizeVideoModes(undefined, null, "not-an-array"), []);
  assert.deepEqual(normalizeVideoModes(["nope"]), []);
});

test("the incident's model shape exposes omni_ref to the admin form", () => {
  // relay 报 multi_ref 时，只认字面量 omni_ref 会让「全能参考」配置区块整块消失，
  // 于是 omniRef.imageCount 永远填不进去——正是 15 张参考图事故的成因之一。
  const modes = ["text_to_video", "image_to_video", "multi_ref"];
  assert.equal(modes.includes("omni_ref"), false);
  assert.equal(normalizeVideoModes(modes).includes("omni_ref"), true);
});
