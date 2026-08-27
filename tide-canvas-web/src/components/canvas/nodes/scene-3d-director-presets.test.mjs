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
  resolveCharacterPropCollisions,
  selectRecognitionModel,
  whiteboxPropPlacement,
  WHITEBOX_PROP_COLOR,
} from "./scene-3d-recognition.ts";

import { selectStoryboardAnalysisModel } from "./video-frame-breakdown.ts";

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
  // 全景走标注模式：模型只在图上标点，米数由代码几何解算
  assert.match(prompt, /等距柱状全景图/);
  assert.match(prompt, /标注模式/);
  assert.match(prompt, /不要自己估算米数/);
  assert.match(prompt, /floorLine/);
  assert.match(prompt, /vBottom为接地点/);
  assert.match(prompt, /不要输出地面、天花板/);
  assert.match(prompt, /不得穿插重叠/);
  assert.match(buildBlockingRecognitionPrompt(), /等距柱状全景图/);
});

test("recognition prefers the backend-configured primary text model", () => {
  const vision = { modelId: "m-vision", type: "text", config: JSON.stringify({ vision: true }) };
  const primary = { modelId: "m-primary", type: "text", config: JSON.stringify({ aiOptimizePrimary: true }) };
  // 主模型优先于启发式挑中的视觉模型
  assert.equal(selectRecognitionModel([vision, primary], selectStoryboardAnalysisModel).modelId, "m-primary");
  // 非文本类目 / 不支持识图 handler / 配置损坏的主模型标记一律无效，回退启发式
  const imagePrimary = { modelId: "m-img", type: "image", config: JSON.stringify({ aiOptimizePrimary: true }) };
  const wrongHandler = {
    modelId: "m-handler", type: "text",
    config: JSON.stringify({ aiOptimizePrimary: true }),
    supportedHandlers: ["other_handler"],
  };
  const broken = { modelId: "m-broken", type: "text", config: "{not json" };
  assert.equal(
    selectRecognitionModel([imagePrimary, wrongHandler, broken, vision], selectStoryboardAnalysisModel).modelId,
    "m-vision",
  );
  assert.equal(selectRecognitionModel([], selectStoryboardAnalysisModel), undefined);
  assert.match(editorSource, /selectRecognitionModel\(modelsResponse\.data, selectStoryboardAnalysisModel\)/);
  assert.match(editorSource, /parseRecognizedWhitebox\(resultText\)/);
  assert.match(editorSource, /blocking\.props \?\? \[\]\)\.forEach|for \(const prop of blocking\.props \?\? \[\]\) addPropInternal\(whiteboxPropPlacement\(prop\)\)/);
  assert.match(editorSource, /whitebox \? "replace" : recognitionMode/);
  assert.match(editorSource, /WHITEBOX_FLOW_STEPS = \["识别场景物品与人物", "生成白膜体块", "摆放人物站位", "覆盖当前导演台"\]/);
  // 白膜覆盖必须连场景资产及其 3D 入边一起清掉，否则体块与旧场景几何叠加
  assert.match(editorSource, /clearSceneAsset: \(\) => \{ void setSceneAssetInternal\(null\); \}/);
  assert.match(editorSource, /apiRef\.current\?\.clearSceneAsset\(\);\s*sceneAssetRef\.current = null;\s*setSceneAsset\(null\);/);
  assert.match(editorSource, /whitebox && candidate\.type === "3d"/);
});

test("pano annotation back-projects ground points into exact metric placement", () => {
  // 圆凳：uc=0.75（正右方），接地点 v=0.75（俯角45°）→ 距离=默认相机高1.6米
  const parsed = parseRecognizedWhitebox(JSON.stringify({
    imageType: "panorama",
    objects: [{ name: "圆凳", kind: "cylinder", u1: 0.7, u2: 0.8, vBottom: 0.75, vTop: 0.5, grounded: true }],
    characters: [],
  }));
  assert.ok(parsed);
  const stool = parsed.props[0];
  assert.ok(Math.abs(stool.x - 1.6) < 1e-6);
  assert.ok(Math.abs(stool.z) < 1e-6);
  // vTop=0.5 为地平线 → 顶高=相机高1.6，y=h/2
  assert.ok(Math.abs(stool.h - 1.6) < 1e-6);
  assert.ok(Math.abs(stool.y - 0.8) < 1e-6);
  // 宽度 = 2·d·tan(水平张角/2)，张角=0.1×2π
  assert.ok(Math.abs(stool.w - 2 * 1.6 * Math.tan(0.1 * Math.PI)) < 1e-6);

  // 跨接缝物体（u1=0.95→u2=0.05）落在正后方 +z
  const seam = parseRecognizedWhitebox(JSON.stringify({
    imageType: "panorama",
    objects: [{ name: "后墙柜", kind: "box", u1: 0.95, u2: 1.05, vBottom: 0.75, vTop: 0.4, grounded: true }],
    characters: [],
  }));
  assert.ok(Math.abs(seam.props[0].z - 1.6) < 1e-4);

  // 接地点在地平线以上无解 → 该物体被丢弃而不是放到无穷远
  assert.equal(parseRecognizedWhitebox(JSON.stringify({
    imageType: "panorama",
    objects: [{ name: "吊灯", kind: "box", u1: 0.4, u2: 0.6, vBottom: 0.45, vTop: 0.2, grounded: true }],
    characters: [],
  })), null);
});

test("floor-line annotation builds a closed wall shell around the origin", () => {
  const floorLine = [0, 0.25, 0.5, 0.75].map((u) => ({ u, v: 0.625 }));
  const parsed = parseRecognizedWhitebox(JSON.stringify({
    imageType: "panorama",
    room: { wallHeight: 3, floorLine },
    objects: [],
    characters: [],
  }));
  assert.ok(parsed);
  // 四个方位的墙脚点 → 首尾闭合的4段墙
  assert.equal(parsed.props.length, 4);
  const d = 1.6 / Math.tan(0.125 * Math.PI); // v=0.625 → 俯角22.5°
  for (const wall of parsed.props) {
    assert.match(wall.name, /^墙/);
    assert.ok(Math.abs(wall.w - Math.SQRT2 * d) < 1e-6);
    assert.equal(wall.h, 3);
    assert.equal(wall.y, 1.5);
    assert.equal(wall.d, 0.15);
  }
});

test("annotated characters are held inside the wall shell", () => {
  // 脚点标得太靠近地平线会解出10米开外，人物必须被按回墙内侧（墙距-0.6米）。
  // u=0.375 正对一段墙的中点（方位角-45°），远离墙角，期望值不受碰撞消解影响。
  const floorLine = [0, 0.25, 0.5, 0.75].map((u) => ({ u, v: 0.625 }));
  const parsed = parseRecognizedWhitebox(JSON.stringify({
    imageType: "panorama",
    room: { wallHeight: 3, floorLine },
    objects: [],
    characters: [{ name: "角色A", preset: "standard-male", u: 0.375, v: 0.55 }],
  }));
  assert.ok(parsed);
  const vertexDistance = 1.6 / Math.tan(0.125 * Math.PI);
  const wallDistance = vertexDistance * Math.cos(Math.PI / 4);
  const held = (wallDistance - 0.6) / Math.SQRT2;
  const character = parsed.characters[0];
  assert.ok(Math.abs(character.x + held) < 1e-3);
  assert.ok(Math.abs(character.z + held) < 1e-3);
});

test("door prior recalibrates camera height so the whole scene rescales", () => {
  // 门顶 v=0.25（仰角45°）在默认相机高下解出3.2米高，触发按2.1米门高的整体缩放
  const parsed = parseRecognizedWhitebox(JSON.stringify({
    imageType: "panorama",
    objects: [{ name: "电梯门", kind: "box", u1: 0.45, u2: 0.55, vBottom: 0.75, vTop: 0.25, grounded: true }],
    characters: [],
  }));
  assert.ok(parsed);
  const door = parsed.props[0];
  // 缩放系数被限幅到0.75 → 相机高1.2米 → 距离1.2、门高2.4
  assert.ok(Math.abs(door.z + 1.2) < 1e-6);
  assert.ok(Math.abs(door.h - 2.4) < 1e-6);
});

test("characters are pushed out of blocking props but not rugs or beams", () => {
  const moved = resolveCharacterPropCollisions(
    [
      { name: "A", preset: "standard-male", x: 0.1, z: 0, rotation: 0, scale: 1 },
      { name: "B", preset: "standard-male", x: 5, z: 0, rotation: 0, scale: 1 },
      { name: "C", preset: "standard-male", x: -5, z: 0, rotation: 0, scale: 1 },
    ],
    [
      { name: "圆台", kind: "cylinder", x: 0, y: 0.55, z: 0, rotation: 0, w: 1, h: 1.1, d: 1 },
      { name: "横梁", kind: "box", x: 5, y: 2.7, z: 0, rotation: 0, w: 4, h: 0.4, d: 0.4 },
      { name: "地毯", kind: "box", x: -5, y: 0.025, z: 0, rotation: 0, w: 4, h: 0.05, d: 4 },
    ],
  );
  // 人物被推出圆台脚印（半径0.5+人物间距0.35）
  assert.ok(Math.hypot(moved[0].x, moved[0].z) >= 0.84);
  // 高处横梁下能走人、贴地地毯上能站人：不动
  assert.equal(moved[1].x, 5);
  assert.equal(moved[2].x, -5);
  // 直出模式解析后同样做碰撞消解
  const parsed = parseRecognizedWhitebox(JSON.stringify({
    props: [{ name: "台子", kind: "cylinder", x: 0, y: 0.55, z: 0, rotation: 0, w: 1, h: 1.1, d: 1 }],
    characters: [{ name: "角色A", preset: "standard-male", x: 0.1, z: 0, rotation: 0, scale: 1 }],
  }));
  assert.ok(Math.hypot(parsed.characters[0].x, parsed.characters[0].z) >= 0.84);
});

test("restored geometry ids cannot create unreachable duplicate scene objects", () => {
  assert.match(rigSource, /const propIds = new Set<string>\(\)/);
  assert.match(rigSource, /while \(propIds\.has\(id\)\)/);
  assert.match(rigSource, /propIds\.add\(id\)/);
});
