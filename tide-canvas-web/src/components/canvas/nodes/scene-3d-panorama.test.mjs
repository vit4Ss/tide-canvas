import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DEFAULT_ENV, normalizeScene3DEnv } from "./scene-3d-env.ts";

const editorSource = readFileSync(new URL("./scene-3d-editor.tsx", import.meta.url), "utf8");

test("panorama metadata survives director state restoration", () => {
  const restored = normalizeScene3DEnv({
    ...DEFAULT_ENV,
    panoUrl: " https://cdn.example.com/panorama.webp ",
    panoTitle: "雨夜天台",
    panoSource: "ai",
    frameAspect: "21:9",
  });
  assert.equal(restored.panoUrl, "https://cdn.example.com/panorama.webp");
  assert.equal(restored.panoTitle, "雨夜天台");
  assert.equal(restored.panoSource, "ai");
  assert.equal(restored.frameAspect, "21:9");
});

test("unsafe persisted panorama attributes are normalized before rendering", () => {
  const restored = normalizeScene3DEnv({
    panoUrl: 42,
    panoTitle: "x".repeat(300),
    panoSource: "unknown",
    panoRotY: 999,
    panoRadius: -5,
    skyColor: "javascript:red",
    showLabels: "yes",
    showGround: false,
    frameAspect: "10:7",
  });
  assert.equal(restored.panoUrl, undefined);
  assert.equal(restored.panoTitle?.length, 200);
  assert.equal(restored.panoSource, undefined);
  assert.equal(restored.panoRotY, 360);
  assert.equal(restored.panoRadius, 10);
  assert.equal(restored.skyColor, DEFAULT_ENV.skyColor);
  assert.equal(restored.showLabels, DEFAULT_ENV.showLabels);
  assert.equal(restored.showGround, false);
  assert.equal(restored.frameAspect, "auto");
});

test("director panorama tab exposes all three product entry points", () => {
  assert.match(editorSource, /title="全景图"/);
  assert.match(editorSource, /本地上传/);
  assert.match(editorSource, /历史记录/);
  assert.match(editorSource, /AI生成/);
  assert.doesNotMatch(editorSource, /title="物体变换"/);
});

test("panorama replacement is race-safe, persistent, and represented by a scene node", () => {
  assert.match(editorSource, /const loadVersion = \+\+panoLoadVersion/);
  assert.match(editorSource, /loadVersion !== panoLoadVersion/);
  assert.match(editorSource, /setPanorama: \(url\)/);
  assert.match(editorSource, /panoUrl: url[\s\S]*panoTitle: title[\s\S]*panoSource: source/);
  assert.match(editorSource, /type: SCENE_NODE_TYPE[\s\S]*is360: true/);
  assert.match(editorSource, /sourceId: id, targetId: node\.id/);
});

test("paid panorama generation is synchronously guarded against rapid double submission", () => {
  assert.match(editorSource, /if \(panoramaGenerateBusyRef\.current\) return/);
  assert.match(editorSource, /panoramaGenerateBusyRef\.current = true/);
  assert.match(editorSource, /finally \{\s*panoramaGenerateBusyRef\.current = false/);
});
