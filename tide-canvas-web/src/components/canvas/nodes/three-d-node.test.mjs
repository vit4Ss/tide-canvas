import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./three-d-node.tsx", import.meta.url), "utf8");

test("canvas 3D node uses the standalone model catalog, pricing and generation parameters", () => {
  assert.match(source, /useAiModels\(\s*AiModelType\.THREE_D/);
  assert.match(source, /modelConfig\.creditCost \?\? selectedModel\?\.pointCost \?\? 0/);
  for (const field of ["enablePbr", "faceCount", "generateType", "resultFormat"]) {
    assert.match(source, new RegExp(`\\b${field}\\b`));
  }
  assert.match(source, /handler: "generate_3d"/);
  assert.match(source, /THREE_D_VIEW_SLOTS\[index\]\.viewType/);
  assert.match(source, /referenceImages\[0\]\.is360 === true/);
  assert.match(source, /singleImageIsPanorama \? \{ isPano: true \}/);
  assert.match(source, /resolveUploadLimitBytes\(configuredMaxBytes\)/);
  assert.match(source, /mode === "t2_3d" \|\| isWorldModel/);
});

test("canvas 3D node previews every GLB as a white model while keeping SPZ downloadable", () => {
  assert.match(source, /const glbUrl = canvasThreeDGlbUrl\(node\)/);
  assert.match(source, /canvasThreeDSceneAssetFromNode\(node\)/);
  assert.match(source, /initialMode="solid"/);
  assert.match(source, /3D 导演台只加载 GLB/);
  assert.match(source, /SPZ 仅作为附加文件下载/);
});
