import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./nodes/image-node.tsx", import.meta.url), "utf8");

test("canvas image card tracks original and thumbnail failures independently", () => {
  assert.match(source, /canvasImagePreview\(\{[\s\S]*?preferOriginal: showAuxUI[\s\S]*?failedUrls:/);
  assert.match(source, /failedUrls: \[\.\.\.new Set\(\[\.\.\.\(prev\.src === currentImageSrc \? prev\.failedUrls : \[\]\), activeCardImageSrc\]\)\]/);
  assert.match(source, /!activeCardImageSrc[\s\S]*?图片暂时无法加载[\s\S]*?>\s*重试\s*</);
  assert.match(source, /原图加载失败，当前显示预览[\s\S]*?重试原图/);
});

test("canvas image lightbox never exposes the node title as broken-image text", () => {
  assert.match(source, /currentPreviewMedia\.failed[\s\S]*?图片暂时无法加载/);
  assert.match(source, /src=\{node\.imageSrc\}[\s\S]*?alt=""[\s\S]*?onError=/);
  assert.doesNotMatch(source, /src=\{node\.imageSrc\}[\s\S]{0,120}?alt=\{node\.title/);
});
