import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { normalizeScene3DSceneAsset } from "./scene-3d-scene-asset.ts";

const editorSource = readFileSync(new URL("./scene-3d-editor.tsx", import.meta.url), "utf8");
const viewportSource = readFileSync(new URL("../../studio/three-d-studio/viewport.tsx", import.meta.url), "utf8");

test("persisted Director scene accepts GLB and migrates Marble SPZ to its collider white model", () => {
  assert.deepEqual(normalizeScene3DSceneAsset({
    url: " https://cdn.example.com/stage.glb?token=1 ",
    title: "摄影棚",
    sourceNodeId: "node_3d",
    source: "connected",
  }), {
    url: "https://cdn.example.com/stage.glb?token=1",
    title: "摄影棚",
    format: "glb",
    materialMode: "solid",
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
    url: "https://cdn.example.com/collider.glb",
    title: "3D 场景",
    format: "glb",
    materialMode: "solid",
    colliderUrl: "https://cdn.example.com/collider.glb",
    // Marble meshes share the SPZ frame — the migrated collider keeps the
    // metric semantics so the Director renders it at room scale.
    metricScaleFactor: 1.2,
    groundPlaneOffset: 0.3,
  });
  assert.equal(normalizeScene3DSceneAsset({
    url: "https://cdn.example.com/textured.glb",
    materialMode: "original",
  })?.materialMode, "original");
  assert.equal(normalizeScene3DSceneAsset({ url: "https://cdn.example.com/stage.fbx" }), undefined);
  assert.equal(normalizeScene3DSceneAsset({ url: "javascript:alert(1).glb" }), undefined);
});

test("Director loads, disposes and persists connected GLB and SPZ scenes", () => {
  assert.match(editorSource, /candidate\?\.type === "3d"/);
  assert.match(editorSource, /new GLTFLoader\(\)\.loadAsync\(objectUrl\)/);
  assert.match(editorSource, /new SplatMesh\(\{ fileBytes: new Uint8Array\(bytes\) \}\)/);
  assert.match(editorSource, /splat\.rotation\.x = Math\.PI/);
  assert.match(editorSource, /group\.name = "connected-3d-scene"/);
  assert.match(editorSource, /sceneAssetMaterialMode = asset\.materialMode \?\? "original"/);
  assert.match(editorSource, /setSceneAssetMaterialMode/);
  assert.match(editorSource, /setSceneAssetMaterialMode: applySceneAssetMaterialMode/);
  assert.match(editorSource, /sceneAssetOriginalMaterials\.forEach/);
  assert.match(editorSource, /"solid", "白模"/);
  assert.match(editorSource, /"original", "原材质"/);
  assert.match(editorSource, /side: THREE\.DoubleSide/);
  assert.match(editorSource, /if \(bounds\.isEmpty\(\)\) throw new Error/);
  assert.match(editorSource, /const textures = new Set<THREE_NS\.Texture>\(\)/);
  assert.match(editorSource, /if \(pendingGroup\) disposeSceneAssetGroup\(pendingGroup\)/);
  assert.match(editorSource, /disposeSceneAssetModel\(\)/);
  assert.match(editorSource, /sceneAsset: sceneAssetRef\.current/);
});

test("viewport white/wire materials render both faces so interior scene meshes stay visible", () => {
  assert.match(viewportSource, /roughness: 0\.75, metalness: 0\.05, side: THREE\.DoubleSide/);
  assert.match(viewportSource, /wireframe: true, side: THREE\.DoubleSide/);
  assert.match(viewportSource, /if \(geo && !geo\.attributes\.normal\) geo\.computeVertexNormals\(\)/);
});

test("Marble scene collider previews frame the camera inside the room", () => {
  assert.match(viewportSource, /frameInterior = false/);
  assert.match(viewportSource, /if \(frameInteriorRef\.current\)/);
  assert.match(viewportSource, /camera\.fov = 65/);
  assert.match(viewportSource, /gridMajor\.position\.y = -0\.002/);
  const nodeSource = readFileSync(new URL("./three-d-node.tsx", import.meta.url), "utf8");
  assert.match(nodeSource, /frameInterior=\{!!directorSceneAsset\?\.colliderUrl\}/);
});

test("newly selected 3D assets reset to the configured default material mode", () => {
  assert.match(viewportSource, /const defaultMode = initialModeRef\.current/);
  assert.match(viewportSource, /setMode\(defaultMode\)/);
  assert.match(viewportSource, /setMode\(defaultMode\);\s*apiRef\.current\?\.loadModel\(glbUrl\)/);
});
