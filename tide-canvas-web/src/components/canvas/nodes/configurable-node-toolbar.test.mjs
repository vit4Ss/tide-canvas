import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const toolbar = readFileSync(new URL("./shared/configurable-node-toolbar.tsx", import.meta.url), "utf8");
const imageNode = readFileSync(new URL("./image-node.tsx", import.meta.url), "utf8");
const videoNode = readFileSync(new URL("./video-node.tsx", import.meta.url), "utf8");

test("overflow actions close only after their own click handler can run", () => {
  assert.match(toolbar, /onClickCapture=\{\(\) => \{[\s\S]*?closeOverflowAfterAction\(\)/);
  assert.match(toolbar, /overflowCloseTimerRef\.current = window\.setTimeout\([\s\S]*?setOverflowState/);
  assert.doesNotMatch(toolbar, /onClickCapture=\{\(\) => \{[\s\S]{0,180}?setOverflowState/);
});

test("nested menus opt out while image and video portal actions use safe deferred closing", () => {
  for (const key of ["image.gridGenerate", "tool.upscale", "image.crop", "image.rotate", "image.gridSplit"]) {
    assert.match(imageNode, new RegExp(`key: "${key.replace(".", "\\.")}"[\\s\\S]{0,160}?closeOverflowOnSelect: false`));
  }
  assert.match(imageNode, /key: "media\.preview"[\s\S]*?setPreviewOpen\(true\)/);
  assert.match(videoNode, /key: "media\.preview"[\s\S]*?setPreviewOpen\(true\)/);
});
