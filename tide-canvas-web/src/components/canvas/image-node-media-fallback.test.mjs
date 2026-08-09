import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./nodes/image-node.tsx", import.meta.url), "utf8");

test("canvas image card retries the original URL before showing a stable failure state", () => {
  assert.match(
    source,
    /!currentCardMedia\.useOriginal && node\.imageSrc && cardDisplaySrc !== node\.imageSrc[\s\S]*?disableOssDisplayProcessing\(node\.imageSrc\)[\s\S]*?useOriginal: true/,
  );
  assert.match(source, /currentCardMedia\.failed[\s\S]*?图片暂时无法加载[\s\S]*?>\s*重试\s*</);
});

test("canvas image lightbox never exposes the node title as broken-image text", () => {
  assert.match(source, /currentPreviewMedia\.failed[\s\S]*?图片暂时无法加载/);
  assert.match(source, /src=\{node\.imageSrc\}[\s\S]*?alt=""[\s\S]*?onError=/);
  assert.doesNotMatch(source, /src=\{node\.imageSrc\}[\s\S]{0,120}?alt=\{node\.title/);
});
