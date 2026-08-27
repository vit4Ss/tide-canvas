import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CAMERA_PRESETS,
  CHARACTER_PRESETS,
  FRAME_ASPECTS,
  characterPreset,
  frameAspect,
} from "./scene-3d-director-presets.ts";
import {
  buildBlockingRecognitionPrompt,
  buildWhiteboxRecognitionPrompt,
  parseRecognizedBlocking,
  parseRecognizedWhitebox,
  recognitionTaskText,
  whiteboxPropPlacement,
  WHITEBOX_PROP_COLOR,
} from "./scene-3d-recognition.ts";

const editorSource = readFileSync(new URL("./scene-3d-editor.tsx", import.meta.url), "utf8");
const rigSource = readFileSync(new URL("./scene-3d-rig.ts", import.meta.url), "utf8");

test("character panel exposes the complete ordered product preset catalog", () => {
  assert.deepEqual(CHARACTER_PRESETS.map((preset) => preset.label), [
    "标准男性", "标准女性", "健硕", "纤细", "少年", "儿童", "宽厚", "二头身",
  ]);
  assert.equal(new Set(CHARACTER_PRESETS.map((preset) => preset.key)).size, CHARACTER_PRESETS.length);
  for (const preset of CHARACTER_PRESETS) {
    assert.ok(preset.bodyScale.every((value) => value > 0));
    assert.ok(preset.defaultScale >= 0.3 && preset.defaultScale <= 3);
  }
  assert.equal(characterPreset("invalid").key, "standard-male");
});

test("camera panel contains every requested usable composition", () => {
  assert.deepEqual(CAMERA_PRESETS.map((preset) => preset.label), [
    "当前视角", "正面中景", "正面特写", "正面全景", "侧面跟拍", "侧面近景", "背面中景",
    "俯拍全景", "45° 俯拍", "低角度仰拍", "低角度广角", "过肩镜头", "过肩镜头（右）", "鸟瞰", "荷兰角",
  ]);
  assert.equal(CAMERA_PRESETS.length, 15);
  for (const preset of CAMERA_PRESETS.slice(1)) {
    assert.equal(preset.position?.length, 3);
    assert.equal(preset.target?.length, 3);
    assert.ok(preset.fov >= 20 && preset.fov <= 120);
  }
  assert.ok(CAMERA_PRESETS.at(-1).roll > 0);
});

test("camera roll is reapplied after orbit updates instead of only being persisted", () => {
  assert.match(editorSource, /const orientRigCamera =/);
  assert.match(editorSource, /orbit\.update\(\);\s*const activeRig = activeRigId[\s\S]*?orientRigCamera\(activeRig\.cam, orbit\.target, activeRig\.roll\)/);
  assert.match(editorSource, /orientRigCamera\(r\.cam, orbit\.target, r\.roll\)/);
});

test("frame aspect catalog matches the seven director choices", () => {
  assert.deepEqual(FRAME_ASPECTS.map((option) => option.label), ["自适应", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]);
  assert.equal(frameAspect("21:9").value, 21 / 9);
  assert.equal(frameAspect("invalid").key, "auto");
});

test("recognition parser strips fences, caps rows and clamps unsafe placement", () => {
  const rows = Array.from({ length: 25 }, (_, index) => ({
    name: `人物${index}`,
    preset: index === 0 ? "child" : "invalid",
    x: index === 0 ? 99 : index / 10,
    z: index === 0 ? -99 : 0,
    rotation: 999,
    scale: -10,
  }));
  const parsed = parseRecognizedBlocking(`\`\`\`json\n${JSON.stringify({ characters: rows, cameraPreset: "front-medium" })}\n\`\`\``);
  assert.ok(parsed);
  assert.equal(parsed.characters.length, 18);
  assert.equal(parsed.characters[0].preset, "child");
  assert.equal(parsed.characters[1].preset, "standard-male");
  assert.equal(parsed.characters[0].x, 4);
  assert.equal(parsed.characters[0].z, -4);
  assert.equal(parsed.characters[0].rotation, 180);
  assert.equal(parsed.characters[0].scale, 0.5);
  assert.equal(parsed.cameraPreset, "front-medium");
  assert.equal(parseRecognizedBlocking("not json"), null);
});

test("recognition request and task text keep a strict machine-readable contract", () => {
  const prompt = buildBlockingRecognitionPrompt();
  assert.match(prompt, /只返回一个JSON对象/);
  assert.match(prompt, /最多识别18人/);
  assert.equal(recognitionTaskText({ text: "result" }), "result");
  assert.equal(recognitionTaskText(JSON.stringify({ text: "result" })), "result");
  assert.equal(recognitionTaskText("broken"), "");
});

test("director rail uses panels instead of direct-add shortcuts", () => {
  for (const label of ["场景", "添加角色", "添加机位", "全景图", "选择画幅比例", "AI识图导入"]) {
    assert.match(editorSource, new RegExp(`title="${label}"`));
  }
  assert.doesNotMatch(editorSource, /onClick=\{\(\) => \{ setSidebarTab\("scene"\); apiRef\.current\?\.addCharacter/);
  assert.match(editorSource, /importBlocking: \(blocking, mode\)/);
  assert.match(editorSource, /addProp: \(kind\)/);
  assert.match(editorSource, /setFrameAspect: \(aspect\)/);
});

test("recognition modal owns focus while it is open", () => {
  assert.match(editorSource, /useFocusTrap<HTMLDivElement>\(!recognitionOpen\)/);
  assert.match(editorSource, /useFocusTrap<HTMLElement>\(recognitionOpen\)/);
  assert.match(editorSource, /ref=\{recognitionDialogRef\}[\s\S]*?aria-label="AI识图导入"[\s\S]*?tabIndex=\{-1\}/);
  assert.match(editorSource, /event\.key === "Escape" && recognitionOpen[\s\S]*?input, textarea/);
});

test("replace recognition clears stale panorama inputs and camera motion", () => {
  assert.match(editorSource, /if \(mode === "replace"\)/);
  assert.match(editorSource, /delete nextEnv\.panoUrl/);
  assert.match(editorSource, /setPanorama\(null\)/);
  assert.match(editorSource, /staleConnections\.forEach[\s\S]*?removeConnection/);
  assert.match(editorSource, /DEFAULT_SCENE_3D_MOTION, keyframes: \[\]/);
});

test("whitebox parser accepts prop-only scenes, caps rows and clamps block dimensions", () => {
  const props = Array.from({ length: 50 }, (_, index) => ({
    name: `物${index}`,
    kind: index === 0 ? "cylinder" : "cube",
    x: index === 0 ? 99 : -1,
    z: index === 0 ? -99 : 0,
    rotation: 999,
    w: 99,
    h: 0.001,
    d: 2,
  }));
  const parsed = parseRecognizedWhitebox(`\`\`\`json\n${JSON.stringify({ props, characters: [] })}\n\`\`\``);
  assert.ok(parsed);
  assert.equal(parsed.characters.length, 0);
  assert.equal(parsed.props.length, 40);
  assert.equal(parsed.props[0].kind, "cylinder");
  assert.equal(parsed.props[1].kind, "box");
  assert.equal(parsed.props[0].x, 8);
  assert.equal(parsed.props[0].z, -8);
  assert.equal(parsed.props[0].rotation, 180);
  assert.equal(parsed.props[0].w, 10);
  assert.equal(parsed.props[0].h, 0.05);
  // y 缺省为限幅后的 h/2，落地物体不会插进地面
  assert.equal(parsed.props[0].y, 0.025);
  assert.equal(parseRecognizedWhitebox(JSON.stringify({ props: [], characters: [] })), null);
  assert.equal(parseRecognizedWhitebox("not json"), null);
});

test("whitebox placement converts meters into base-geometry prop transforms", () => {
  const placement = whiteboxPropPlacement({ name: "沙发", kind: "box", x: -1.2, y: 0.4, z: 0.6, rotation: 90, w: 2, h: 0.8, d: 0.9 });
  assert.deepEqual(placement.pos, [-1.2, 0.4, 0.6]);
  assert.ok(Math.abs(placement.rot[1] - Math.PI / 2) < 1e-9);
  assert.deepEqual(placement.scale, [2 / 0.8, 1, 0.9 / 0.8]);
  assert.equal(placement.color, WHITEBOX_PROP_COLOR);
  const cylinder = whiteboxPropPlacement({ name: "杯", kind: "cylinder", x: 0, y: 0.8, z: 0, rotation: 0, w: 0.1, h: 0.1, d: 0.1 });
  assert.deepEqual(cylinder.scale, [0.125, 0.1 / 0.9, 0.125]);
  // 基准尺寸必须与编辑器 addPropInternal 创建的几何一致
  assert.match(editorSource, /BoxGeometry\(0\.8, 0\.8, 0\.8\)/);
  assert.match(editorSource, /SphereGeometry\(0\.45, 32, 20\)/);
  assert.match(editorSource, /CylinderGeometry\(0\.4, 0\.4, 0\.9, 32\)/);
});

test("whitebox generation wires prompt, prop import and forced replace into the editor", () => {
  const prompt = buildWhiteboxRecognitionPrompt();
  assert.match(prompt, /只返回一个JSON对象/);
  assert.match(prompt, /kind只能是box、sphere、cylinder/);
  assert.match(prompt, /不要虚构/);
  assert.match(editorSource, /parseRecognizedWhitebox\(resultText\)/);
  assert.match(editorSource, /blocking\.props \?\? \[\]\)\.forEach|for \(const prop of blocking\.props \?\? \[\]\) addPropInternal\(whiteboxPropPlacement\(prop\)\)/);
  assert.match(editorSource, /whitebox \? "replace" : recognitionMode/);
  assert.match(editorSource, /WHITEBOX_FLOW_STEPS = \["识别场景物品与人物", "生成白膜体块", "摆放人物站位", "覆盖当前导演台"\]/);
  // 白膜覆盖必须连场景资产及其 3D 入边一起清掉，否则体块与旧场景几何叠加
  assert.match(editorSource, /clearSceneAsset: \(\) => \{ void setSceneAssetInternal\(null\); \}/);
  assert.match(editorSource, /apiRef\.current\?\.clearSceneAsset\(\);\s*sceneAssetRef\.current = null;\s*setSceneAsset\(null\);/);
  assert.match(editorSource, /whitebox && candidate\.type === "3d"/);
});

test("restored geometry ids cannot create unreachable duplicate scene objects", () => {
  assert.match(rigSource, /const propIds = new Set<string>\(\)/);
  assert.match(rigSource, /while \(propIds\.has\(id\)\)/);
  assert.match(rigSource, /propIds\.add\(id\)/);
});
