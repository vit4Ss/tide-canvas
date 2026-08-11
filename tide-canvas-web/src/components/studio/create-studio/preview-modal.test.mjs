import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const here = new URL(".", import.meta.url);
const read = (relative) => readFileSync(new URL(relative, here), "utf8");

test("uploaded reference videos use a real controlled player instead of a decorative play button", () => {
  const preview = read("./preview-modal.tsx");
  const videoResult = read("./video-result.tsx");
  const videoBranchStart = preview.indexOf('} else if (type === "video") {');
  const videoBranchEnd = preview.indexOf("} else {", videoBranchStart + 1);
  const videoBranch = preview.slice(videoBranchStart, videoBranchEnd);

  assert.ok(videoBranchStart >= 0 && videoBranchEnd > videoBranchStart);
  assert.match(videoBranch, /<VideoPreview[^>]*src=\{f\.url\}/);
  assert.doesNotMatch(videoBranch, /ws-prev-play/);
  assert.match(preview, /<CapturableVideo[\s\S]*?controls[\s\S]*?showFrameCapture=\{false\}/);
  assert.match(preview, /onError=\{\(\) => setFailed\(true\)\}/);
  assert.match(videoResult, /showFrameCapture\?: boolean/);
  assert.match(videoResult, /\{showFrameCapture && \(/);
});

test("preview metadata keeps the correct media type without a dangling separator", () => {
  const preview = read("./preview-modal.tsx");

  assert.match(preview, /type === "image" \? "图片" : type === "video" \? "视频" : "音频"/);
  assert.match(preview, /\[typeLabel, f\.d\?\.trim\(\)\]\.filter\(Boolean\)\.join\(" · "\)/);
  assert.doesNotMatch(preview, /"视频 · "/);
});
