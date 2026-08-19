import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node's native TypeScript loader requires the source suffix.
import { studioReferenceIssue, uploadedFileUrls } from "./required-reference.ts";
import type { SlotData, UploadFile } from "./types";

const file = (url?: string, uploading = false): UploadFile => ({
  n: "reference",
  ...(url !== undefined ? { url } : {}),
  ...(uploading ? { uploading: true } : {}),
});
const issue = (tool: Parameters<typeof studioReferenceIssue>[0], slots: SlotData, activeSlotCount = Object.keys(slots).length) =>
  studioReferenceIssue(tool, slots, activeSlotCount);

test("single-image modes reject their exact missing input and accept a trimmed URL", () => {
  assert.equal(issue("i2i", { img: [] })?.message, "图生图必须上传参考图片");
  assert.equal(issue("edit", { img: [] })?.message, "改图必须上传原图");
  assert.equal(issue("i2v", { first: [] })?.message, "图生视频必须上传首帧图片");
  assert.equal(issue("i2i", { img: [file("   ")] })?.message, "图生图必须上传参考图片");
  assert.equal(issue("i2i", { img: [file("  https://cdn.example/ref.png  ")] }), null);
  assert.deepEqual(uploadedFileUrls([file("  https://cdn.example/ref.png  "), file(" ")]), [
    "https://cdn.example/ref.png",
  ]);
});

test("first-last-frame mode reports the first missing frame in display order", () => {
  const first = file("https://cdn.example/first.png");
  const last = file("https://cdn.example/last.png");

  assert.equal(issue("flf", { first: [], last: [] })?.message, "首尾帧模式需要上传首帧");
  assert.equal(issue("flf", { first: [first], last: [] })?.message, "首尾帧模式需要上传尾帧");
  assert.equal(issue("flf", { first: [], last: [last] })?.message, "首尾帧模式需要上传首帧");
  assert.equal(issue("flf", { first: [first], last: [last] }), null);
});

test("omni reference accepts any enabled media kind and rejects an unusable model", () => {
  assert.deepEqual(issue("ref", {}, 0), {
    message: "该模型未启用任何全能参考素材，请联系管理员",
    severity: "error",
    markRequired: false,
  });
  assert.equal(issue("ref", { img: [], video: [], audio: [] })?.markRequired, true);
  assert.equal(issue("ref", { img: [file("https://cdn.example/ref.png")], video: [], audio: [] }), null);
  assert.equal(issue("ref", { img: [], video: [file("https://cdn.example/ref.mp4")], audio: [] }), null);
  assert.equal(issue("ref", { img: [], video: [], audio: [file("https://cdn.example/ref.mp3")] }), null);
});

test("an active upload blocks every reference mode before missing-file feedback", () => {
  assert.deepEqual(issue("flf", { first: [file(undefined, true)], last: [] }), {
    message: "参考素材上传中，请稍候…",
    severity: "info",
    markRequired: false,
  });
  assert.equal(issue("t2i", {}), null);
});

test("blank omni media URLs never count as an uploaded reference", () => {
  assert.equal(
    issue("ref", { img: [], video: [file("  ")], audio: [file("\t")] })?.message,
    "请先上传参考素材（图片 / 视频 / 音频）",
  );
});

test("a pending upload blocks submit even when another reference already has a URL", () => {
  assert.equal(
    issue("i2i", { img: [file("https://cdn.example/ready.png"), file(undefined, true)] })?.message,
    "参考素材上传中，请稍候…",
  );
});
