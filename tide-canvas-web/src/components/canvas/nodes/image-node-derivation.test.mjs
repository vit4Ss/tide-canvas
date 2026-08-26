import assert from "node:assert/strict";
import test from "node:test";
import { isPanoramaCanvasNode } from "../../../lib/canvas-node-types.ts";
import { buildImageDerivativeMetadata, imageDerivativeTitle } from "./image-node-derivation.ts";

const source = {
  id: "character-1",
  type: "character",
  x: 0,
  y: 0,
  width: 608,
  height: 465,
  title: "林默",
  prompt: "黑色短发，灰色风衣",
  generationConfig: {
    modelId: "old-model",
    quality: "draft",
    resolution: "1K",
    batchCount: 4,
  },
};

test("character derivatives keep identity text and the actual generation settings", () => {
  assert.deepEqual(buildImageDerivativeMetadata({
    source,
    outputType: "character",
    modelId: "portrait-model",
    generationInput: { quality: "high", clarity: "4K" },
  }), {
    prompt: "黑色短发，灰色风衣",
    generationConfig: {
      modelId: "portrait-model",
      quality: "high",
      resolution: "4K",
      batchCount: 1,
    },
  });
});

test("an explicitly downgraded image does not masquerade as a character", () => {
  const metadata = buildImageDerivativeMetadata({
    source,
    outputType: "image",
    modelId: "portrait-model",
    generationInput: { quality: "standard", resolution: "2K" },
  });
  assert.equal("prompt" in metadata, false);
  assert.equal(metadata.generationConfig.modelId, "portrait-model");
});

test("character close-up titles retain the identity without repeating the suffix", () => {
  assert.equal(imageDerivativeTitle("林默", "角色特写图"), "林默 · 角色特写图");
  assert.equal(imageDerivativeTitle("林默 · 角色特写图", "角色特写图"), "林默 · 角色特写图");
  assert.equal(imageDerivativeTitle(undefined, "角色特写图"), "角色特写图");
});

test("panorama lookup accepts every image carrier semantic type", () => {
  assert.equal(isPanoramaCanvasNode({ type: "image", is360: true }), true);
  assert.equal(isPanoramaCanvasNode({ type: "character", is360: true }), true);
  assert.equal(isPanoramaCanvasNode({ type: "scene", is360: true }), true);
  assert.equal(isPanoramaCanvasNode({ type: "video", is360: true }), false);
  assert.equal(isPanoramaCanvasNode({ type: "character", is360: false }), false);
});
