import assert from "node:assert/strict";
import test from "node:test";
import {
  isRhUpscaleModel, rhUpscaleInput, selectUpscaleModel, recoveredUpscaleSettings, videoUpscaleDefaults,
} from "./video-upscale.ts";

test("RH model detection uses the upstream key", () => {
  assert.equal(isRhUpscaleModel({ modelKey: "rh-upscale" }), true);
  assert.equal(isRhUpscaleModel({ modelKey: " RH-UPSCALE " }), true);
  assert.equal(isRhUpscaleModel({ modelKey: "wavespeed-ai/video-upscaler" }), false);
  assert.equal(isRhUpscaleModel(null), false);
});

test("RH controls preserve route defaults until explicitly selected", () => {
  const model = { modelKey: "rh-upscale" };
  assert.deepEqual(rhUpscaleInput(model, "", ""), {});
  assert.deepEqual(rhUpscaleInput(model, "1x", "max"), { outputFps: "1x", upscaleModel: "max" });
  assert.deepEqual(rhUpscaleInput(model, "59.94", ""), { outputFps: "59.94" });
  assert.deepEqual(rhUpscaleInput(model, "", "high"), { upscaleModel: "high" });
});

test("switching away from RH does not submit its retained control values", () => {
  for (const modelKey of ["wavespeed-ai/video-upscaler", "wavespeed-ai/video-upscaler-pro", "bytedance/video-upscaler"]) {
    assert.deepEqual(rhUpscaleInput({ modelKey }, "4x", "max"), {});
  }
});

test("recovering RH selects the original model even when WaveSpeed is listed first", () => {
  const wave = { id: "wave-row", modelKey: "wavespeed-ai/video-upscaler" };
  const rh = { id: "rh-row", modelKey: "rh-upscale" };
  const models = [wave, rh];
  for (const modelId of ["rh-row", "rh-upscale"]) {
    const state = recoveredUpscaleSettings({ payload: { modelId, input: { outputFps: "2x", upscaleModel: "max" } } });
    assert.equal(selectUpscaleModel(models, state.modelId), rh);
    assert.deepEqual(rhUpscaleInput(rh, state.outputFps, state.upscaleModel), { outputFps: "2x", upscaleModel: "max" });
  }
});

test("recovery prefers the frozen payload and supports legacy numeric and nested options", () => {
  assert.deepEqual(recoveredUpscaleSettings({
    payload: { modelId: "rh-upscale", input: { output_fps: 59.94, upscale_model: "high", extras: { output_fps: "1x", upscale_model: "low" } } },
    recovery: { modelId: "wrong", outputFps: "4x", upscaleModel: "max" },
  }), { modelId: "rh-upscale", outputFps: "59.94", upscaleModel: "high" });
  assert.deepEqual(recoveredUpscaleSettings({
    payload: { modelId: "rh-upscale", input: { extras: { output_fps: "3x", upscale_model: "medium" } } },
  }), { modelId: "rh-upscale", outputFps: "3x", upscaleModel: "medium" });
  assert.deepEqual(recoveredUpscaleSettings({ recovery: { modelId: "rh-row", outputFps: "1x", upscaleModel: "max" } }),
    { modelId: "rh-row", outputFps: "1x", upscaleModel: "max" });
});

test("tool defaults cannot leak RH fields to other models and are not mutated", () => {
  const defaults = {
    targetResolution: "1080p", outputFps: "2x", output_fps: 60, upscaleModel: "max", upscale_model: "high",
    extras: { output_fps: "4x", upscale_model: "low", unrelated: true },
  };
  const snapshot = structuredClone(defaults);
  const model = { modelKey: "wavespeed-ai/video-upscaler" };
  assert.deepEqual(videoUpscaleDefaults(model, defaults), { targetResolution: "1080p", extras: { unrelated: true } });
  assert.deepEqual(videoUpscaleDefaults(model, { extras: { output_fps: "1x" } }), {});
  assert.deepEqual(videoUpscaleDefaults({ modelKey: "rh-upscale" }, defaults), defaults);
  assert.deepEqual(defaults, snapshot);
});
