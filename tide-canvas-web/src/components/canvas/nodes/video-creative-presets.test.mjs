import assert from "node:assert/strict";
import test from "node:test";
import { buildVideoCreativePrompt, VIDEO_CAMERA_PRESETS, VIDEO_EFFECT_PRESETS } from "./video-creative-presets.ts";

const camera = VIDEO_CAMERA_PRESETS.find((preset) => preset.id === "camera-dolly-in");
const effect = VIDEO_EFFECT_PRESETS.find((preset) => preset.id === "effect-rain");

test("selected camera and effect add actual guidance without changing the saved prompt", () => {
  const base = "一辆汽车驶过街道";
  const result = buildVideoCreativePrompt(base, effect.id, camera.id);
  assert.ok(result.startsWith(base));
  assert.ok(result.includes(camera.prompt));
  assert.ok(result.includes(effect.prompt));
  assert.equal(base, "一辆汽车驶过街道");
});

test("changing or clearing a selected ID replaces guidance on the next generation", () => {
  const base = "街道上的行人";
  const snow = VIDEO_EFFECT_PRESETS.find((preset) => preset.id === "effect-snow");
  const changed = buildVideoCreativePrompt(base, snow.id, camera.id);
  assert.ok(changed.includes(snow.prompt));
  assert.ok(!changed.includes(effect.prompt));
  assert.equal(buildVideoCreativePrompt(base), base);
  assert.ok(!buildVideoCreativePrompt(base, undefined, camera.id).includes(effect.prompt));
});

test("repeated composition does not duplicate guidance already present", () => {
  const first = buildVideoCreativePrompt("静谧的山林", effect.id, camera.id);
  assert.equal(buildVideoCreativePrompt(first, effect.id, camera.id), first);
  assert.equal(buildVideoCreativePrompt(camera.prompt, undefined, camera.id), camera.prompt);
});

test("unknown or cross-category IDs never append unintended guidance", () => {
  const base = "保持原始文案\n";
  assert.equal(buildVideoCreativePrompt(base, "missing", "missing"), base);
  assert.equal(buildVideoCreativePrompt(base, camera.id, effect.id), base);
});
