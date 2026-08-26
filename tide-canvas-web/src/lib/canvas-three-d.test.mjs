import assert from "node:assert/strict";
import test from "node:test";
import {
  canvasThreeDAssetsFromMeta,
  canvasThreeDGlbUrl,
  canvasThreeDPreviewUrl,
} from "./canvas-three-d.ts";

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
