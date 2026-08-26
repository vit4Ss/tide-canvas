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
  parseRecognizedBlocking,
  recognitionTaskText,
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
  assert.match(editorSource, /if \(recognitionMode === "replace"\)/);
  assert.match(editorSource, /delete nextEnv\.panoUrl/);
  assert.match(editorSource, /setPanorama\(null\)/);
  assert.match(editorSource, /panoramaConnections\.forEach[\s\S]*?removeConnection/);
  assert.match(editorSource, /DEFAULT_SCENE_3D_MOTION, keyframes: \[\]/);
});

test("restored geometry ids cannot create unreachable duplicate scene objects", () => {
  assert.match(rigSource, /const propIds = new Set<string>\(\)/);
  assert.match(rigSource, /while \(propIds\.has\(id\)\)/);
  assert.match(rigSource, /propIds\.add\(id\)/);
});
