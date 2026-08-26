import assert from "node:assert/strict";
import test from "node:test";
import {
  canvasThreeDAssetExtension,
  canvasThreeDAssetsFromMeta,
  canvasThreeDGlbUrl,
  canvasThreeDPreviewUrl,
  canvasThreeDSceneAssetFromNode,
  canvasThreeDSpzAsset,
} from "./canvas-three-d.ts";

test("3D provider variants keep real download extensions", () => {
  assert.equal(canvasThreeDAssetExtension("spz-500k", "https://cdn.example.com/download?id=1"), "spz");
  assert.equal(canvasThreeDAssetExtension("glb-hq", "https://cdn.example.com/download?id=2"), "glb");
  assert.equal(canvasThreeDAssetExtension("spz-full", "https://cdn.example.com/world.spz?token=1"), "spz");
  assert.equal(canvasThreeDAssetExtension("obj", "https://cdn.example.com/model.obj"), "obj");
});

test("3D task metadata keeps every durable format and its preview", () => {
  const assets = canvasThreeDAssetsFromMeta({
    assets: [
      { type: "obj", url: "https://cdn.example.com/model.obj" },
      { type: "GLB", url: "https://cdn.example.com/model.glb?version=2", previewImageUrl: "https://cdn.example.com/preview.webp" },
      { type: "glb", url: "javascript:alert(1)" },
    ],
  });
  assert.equal(assets.length, 2);
  assert.equal(assets[1].type, "glb");
  assert.equal(assets[1].previewImageUrl, "https://cdn.example.com/preview.webp");
});

test("3D task metadata also tolerates a JSON string response", () => {
  const assets = canvasThreeDAssetsFromMeta(JSON.stringify({
    assets: [{ type: "glb", url: "https://cdn.example.com/model.glb" }],
  }));
  assert.deepEqual(assets, [{ type: "glb", url: "https://cdn.example.com/model.glb" }]);
  assert.deepEqual(canvasThreeDAssetsFromMeta("not-json"), []);
});

test("Director selects GLB independently from the primary download format", () => {
  const node = {
    modelSrc: "https://cdn.example.com/model.obj",
    modelAssets: [
      { type: "obj", url: "https://cdn.example.com/model.obj" },
      { type: "glb", url: "https://cdn.example.com/model.glb", previewImageUrl: "https://cdn.example.com/preview.png" },
    ],
  };
  assert.equal(canvasThreeDGlbUrl(node), "https://cdn.example.com/model.glb");
  assert.equal(canvasThreeDPreviewUrl(node), "https://cdn.example.com/preview.png");
});

test("non-GLB output is not offered to the Director", () => {
  assert.equal(canvasThreeDGlbUrl({ modelSrc: "https://cdn.example.com/model.stl" }), null);
  assert.equal(canvasThreeDGlbUrl({ modelSrc: "javascript:alert(1).glb" }), null);
  assert.equal(canvasThreeDGlbUrl({ modelAssets: [{ type: "glb", url: "javascript:alert(1)" }] }), null);
  assert.equal(canvasThreeDPreviewUrl({ modelPreviewSrc: "javascript:alert(1)" }), null);
});

test("Marble SPZ is preferred as the Director visual scene while retaining collider GLB", () => {
  const node = {
    id: "world_1",
    title: "森林场景",
    modelAssets: [
      { type: "spz-full", url: "https://cdn.example.com/world-full.spz", metricScaleFactor: 1.25, groundPlaneOffset: 0.4 },
      { type: "spz-500k", url: "https://cdn.example.com/world-500k.spz", metricScaleFactor: 1.25, groundPlaneOffset: 0.4 },
      { type: "glb", url: "https://cdn.example.com/collider.glb" },
    ],
  };
  assert.equal(canvasThreeDSpzAsset(node)?.type, "spz-500k");
  assert.deepEqual(canvasThreeDSceneAssetFromNode(node), {
    url: "https://cdn.example.com/world-500k.spz",
    format: "spz",
    colliderUrl: "https://cdn.example.com/collider.glb",
    metricScaleFactor: 1.25,
    groundPlaneOffset: 0.4,
    title: "森林场景",
    sourceNodeId: "world_1",
    source: "connected",
  });
});

test("Director falls back to lightweight SPZ before full resolution", () => {
  const node = {
    modelAssets: [
      { type: "spz-full", url: "https://cdn.example.com/world-full.spz" },
      { type: "spz-100k", url: "https://cdn.example.com/world-100k.spz" },
    ],
  };
  assert.equal(canvasThreeDSpzAsset(node)?.type, "spz-100k");
});
