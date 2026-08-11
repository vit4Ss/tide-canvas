import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runPromptReferences, splitRunPrompt } from "./run-prompt-mentions.ts";

const stageFeedSource = readFileSync(new URL("./stage-feed.tsx", import.meta.url), "utf8");

const params = (overrides = {}) => ({
  prompt: "",
  model: "model",
  tool: "i2i",
  curType: "image",
  ratio: "1:1",
  imgRes: "2K",
  res: "1080p",
  dur: "5s",
  quality: "",
  count: 1,
  ...overrides,
});

test("finished Studio prompts map persisted image references to their original labels", () => {
  const refs = runPromptReferences(params({ imageRefs: ["https://cdn.test/one.png"] }));
  assert.deepEqual(refs.map(({ kind, index, label, source }) => ({ kind, index, label, source })), [
    { kind: "image", index: 1, label: "图片1", source: "https://cdn.test/one.png" },
  ]);
  assert.deepEqual(splitRunPrompt("图片1 让画面下雨", refs).map((part) => part.kind), [
    "reference",
    "text",
  ]);
});

test("first/last-frame references keep image1/image2 order without duplicating i2v firstFrame", () => {
  const flf = runPromptReferences(params({
    tool: "flf",
    firstFrame: "https://cdn.test/first.png",
    lastFrame: "https://cdn.test/last.png",
  }));
  assert.deepEqual(flf.map((ref) => ref.label), ["图片1", "图片2"]);

  const i2v = runPromptReferences(params({
    tool: "i2v",
    imageRefs: ["https://cdn.test/first.png"],
    firstFrame: "https://cdn.test/first.png",
  }));
  assert.deepEqual(i2v.map((ref) => ref.label), ["图片1"]);
});

test("legacy prompts without a persisted matching URL remain plain text", () => {
  assert.deepEqual(splitRunPrompt("图片1 让画面下雨", []), [
    { kind: "text", value: "图片1" },
    { kind: "text", value: " 让画面下雨" },
  ]);
});

test("mixed-media references retain the composer's per-kind numbering", () => {
  const refs = runPromptReferences(params({
    tool: "ref",
    imageRefs: ["https://cdn.test/image.png"],
    videoRefs: ["https://cdn.test/video.mp4"],
    audioRefs: ["https://cdn.test/audio.mp3"],
  }));
  assert.deepEqual(refs.map((ref) => ref.label), ["图片1", "视频1", "音频1"]);
});

test("both in-flight and finished feed prompts render persisted reference pills", () => {
  assert.match(stageFeedSource, /<RunPromptText prompt=\{meta\.prompt\} params=\{meta\.params\} onZoom=\{onZoom\} \/>/);
  assert.match(stageFeedSource, /<RunPromptText prompt=\{r\.prompt\} params=\{r\.params\} onZoom=\{onZoom\} \/>/);
  assert.match(
    stageFeedSource,
    /function RunPromptMention[\s\S]*?fallbackOssDisplayImage\(event\.currentTarget, reference\.source\)/,
  );
});
