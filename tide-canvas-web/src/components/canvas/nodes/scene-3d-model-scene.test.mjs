import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { normalizeScene3DSceneAsset } from "./scene-3d-scene-asset.ts";

const editorSource = readFileSync(new URL("./scene-3d-editor.tsx", import.meta.url), "utf8");

test("persisted Director scene only accepts a GLB URL", () => {
  assert.deepEqual(normalizeScene3DSceneAsset({
    url: " https://cdn.example.com/stage.glb?token=1 ",
    title: "摄影棚",
    sourceNodeId: "node_3d",
    source: "connected",
  }), {
    url: "https://cdn.example.com/stage.glb?token=1",
    title: "摄影棚",
    sourceNodeId: "node_3d",
    source: "connected",
  });
  assert.equal(normalizeScene3DSceneAsset({ url: "https://cdn.example.com/stage.fbx" }), undefined);
  assert.equal(normalizeScene3DSceneAsset({ url: "javascript:alert(1).glb" }), undefined);
});

test("Director loads, disposes and persists the connected GLB scene", () => {
  assert.match(editorSource, /candidate\?\.type === "3d"/);
  assert.match(editorSource, /new GLTFLoader\(\)\.loadAsync\(objectUrl\)/);
  assert.match(editorSource, /group\.name = "connected-3d-scene"/);
  assert.match(editorSource, /if \(bounds\.isEmpty\(\)\) throw new Error/);
  assert.match(editorSource, /const textures = new Set<THREE_NS\.Texture>\(\)/);
  assert.match(editorSource, /if \(pendingGroup\) disposeSceneAssetGroup\(pendingGroup\)/);
  assert.match(editorSource, /disposeSceneAssetModel\(\)/);
  assert.match(editorSource, /sceneAsset: sceneAssetRef\.current/);
});
