import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { normalizeScene3DSceneAsset } from "./scene-3d-scene-asset.ts";

const editorSource = readFileSync(new URL("./scene-3d-editor.tsx", import.meta.url), "utf8");

test("persisted Director scene accepts GLB and Marble SPZ URLs", () => {
  assert.deepEqual(normalizeScene3DSceneAsset({
    url: " https://cdn.example.com/stage.glb?token=1 ",
    title: "摄影棚",
    sourceNodeId: "node_3d",
    source: "connected",
  }), {
    url: "https://cdn.example.com/stage.glb?token=1",
    title: "摄影棚",
    format: "glb",
    sourceNodeId: "node_3d",
    source: "connected",
  });
  assert.deepEqual(normalizeScene3DSceneAsset({
    url: "https://cdn.example.com/world.spz?token=1",
    format: "spz",
    colliderUrl: "https://cdn.example.com/collider.glb",
    metricScaleFactor: 1.2,
    groundPlaneOffset: 0.3,
  }), {
    url: "https://cdn.example.com/world.spz?token=1",
    title: "3D 场景",
    format: "spz",
    colliderUrl: "https://cdn.example.com/collider.glb",
    metricScaleFactor: 1.2,
    groundPlaneOffset: 0.3,
  });
  assert.equal(normalizeScene3DSceneAsset({ url: "https://cdn.example.com/stage.fbx" }), undefined);
  assert.equal(normalizeScene3DSceneAsset({ url: "javascript:alert(1).glb" }), undefined);
});

test("Director loads, disposes and persists connected GLB and SPZ scenes", () => {
  assert.match(editorSource, /candidate\?\.type === "3d"/);
  assert.match(editorSource, /new GLTFLoader\(\)\.loadAsync\(objectUrl\)/);
  assert.match(editorSource, /new SplatMesh\(\{ fileBytes: new Uint8Array\(bytes\) \}\)/);
  assert.match(editorSource, /splat\.rotation\.x = Math\.PI/);
  assert.match(editorSource, /group\.name = "connected-3d-scene"/);
  assert.match(editorSource, /if \(bounds\.isEmpty\(\)\) throw new Error/);
  assert.match(editorSource, /const textures = new Set<THREE_NS\.Texture>\(\)/);
  assert.match(editorSource, /if \(pendingGroup\) disposeSceneAssetGroup\(pendingGroup\)/);
  assert.match(editorSource, /disposeSceneAssetModel\(\)/);
  assert.match(editorSource, /sceneAsset: sceneAssetRef\.current/);
});
