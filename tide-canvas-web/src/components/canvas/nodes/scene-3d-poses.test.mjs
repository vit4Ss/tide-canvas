import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  POSE_NAMES,
  POSE_PARAM_PRESETS,
  POSE_ROOT_DROP,
  SKINNED_POSE_PARAM_PRESETS,
  SKINNED_ANIMATION_POSES,
} from "./scene-3d-poses.ts";

const expected = [
  "站立", "T型", "行走", "跑步",
  "坐姿", "蹲下", "单膝跪", "双膝跪",
  "叉腰", "倚靠", "鞠躬", "思考",
  "格斗", "踢球", "投掷", "推进",
  "招手", "伸手", "抱臂", "看手机",
];

const sliderBounds = {
  hipsPitch: [-45, 45], hipsRoll: [-30, 30],
  chestPitch: [-45, 45], chestYaw: [-60, 60], chestRoll: [-30, 30],
  headPitch: [-40, 40], headYaw: [-70, 70], headRoll: [-30, 30],
  armLFwd: [-90, 90], armLAbd: [-90, 45], armLTwist: [-80, 80],
  armRFwd: [-90, 90], armRAbd: [-90, 90], armRTwist: [-80, 80],
  elbowL: [0, 140], elbowR: [0, 140],
  legLFwd: [-90, 45], legLAbd: [-20, 60], legLTwist: [-45, 45],
  legRFwd: [-90, 45], legRAbd: [-20, 60], legRTwist: [-45, 45],
  kneeL: [0, 140], kneeR: [0, 140],
};

test("director pose catalog contains the complete ordered preset set", () => {
  assert.deepEqual([...POSE_NAMES], expected);
  assert.equal(new Set(POSE_NAMES).size, 20);
});

test("every non-animation action has a finite articulated pose", () => {
  const procedural = expected.filter((name) => !["站立", "T型", "行走", "跑步"].includes(name));
  for (const name of procedural) {
    const params = POSE_PARAM_PRESETS[name];
    assert.ok(params, `${name} is missing pose parameters`);
    assert.ok(Object.keys(params).length >= 4, `${name} needs an articulated pose`);
    assert.ok(Object.values(params).every(Number.isFinite), `${name} contains an invalid angle`);
  }
});

test("XBot uses a complete model-specific pose calibration", () => {
  const procedural = expected.filter((name) => !["T型", "行走", "跑步"].includes(name));
  for (const name of procedural) {
    const params = name === "T型" ? undefined : SKINNED_POSE_PARAM_PRESETS[name];
    if (name === "T型") continue;
    assert.ok(params, `${name} is missing XBot pose parameters`);
    assert.ok(Object.keys(params).length >= 2, `${name} needs XBot pose parameters`);
    assert.ok(Object.values(params).every(Number.isFinite), `${name} contains an invalid XBot angle`);
  }
  assert.notEqual(
    SKINNED_POSE_PARAM_PRESETS["叉腰"].armLTwist,
    SKINNED_POSE_PARAM_PRESETS["叉腰"].armRTwist,
    "mirrored XBot shoulder twists must be calibrated independently",
  );
});

test("procedural pose attributes match real sliders and stay within their limits", () => {
  for (const [catalog, presets] of [["mannequin", POSE_PARAM_PRESETS], ["XBot", SKINNED_POSE_PARAM_PRESETS]]) {
    for (const [pose, params] of Object.entries(presets)) {
      for (const [key, value] of Object.entries(params)) {
        const bounds = sliderBounds[key];
        assert.ok(bounds, `${catalog} ${pose} uses unknown pose attribute ${key}`);
        assert.ok(value >= bounds[0] && value <= bounds[1], `${catalog} ${pose}.${key} exceeds slider limits`);
      }
    }
  }
});

test("the native XBot clips are reserved for walking and running", () => {
  assert.deepEqual(Object.keys(SKINNED_ANIMATION_POSES), ["行走", "跑步"]);
});

test("grounded poses sink the hips so feet/knees land on the floor", () => {
  assert.deepEqual(Object.keys(POSE_ROOT_DROP), ["坐姿", "蹲下", "单膝跪", "双膝跪"]);
  for (const [pose, drop] of Object.entries(POSE_ROOT_DROP)) {
    assert.ok(POSE_NAMES.includes(pose), `${pose} is not a catalog pose`);
    assert.ok(drop > 0.2 && drop < 0.8, `${pose} drop ${drop} is not a plausible hip sink`);
  }
});

test("figures apply, persist and restore the hip drop and per-preset head scale", () => {
  const rigSource = readFileSync(new URL("./scene-3d-rig.ts", import.meta.url), "utf8");
  assert.match(rigSource, /export const ROOT_DROP_ARCHIVE_KEY = "__rootDrop"/);
  // 两种 Figure 都要：预设应用下沉、存档写入、恢复读取
  assert.equal((rigSource.match(/setRootDrop\(POSE_ROOT_DROP\[name as keyof typeof POSE_ROOT_DROP\] \?\? 0\)/g) ?? []).length, 2);
  assert.equal((rigSource.match(/rec\[ROOT_DROP_ARCHIVE_KEY\] = \[round4\(rootDrop\), 0, 0\]/g) ?? []).length, 2);
  assert.equal((rigSource.match(/if \(k === ROOT_DROP_ARCHIVE_KEY\) \{ setRootDrop\(r\[0\]\); continue; \}/g) ?? []).length, 2);
  // 头身比在绑定快照前定型，姿势重置不会抹掉
  assert.match(rigSource, /headScale = 1,?\r?\n\): Figure/);
  assert.match(rigSource, /bones\.get\("Head"\)\?\.scale\.setScalar\(headScale\)/);
  assert.match(rigSource, /man\.joints\.get\("head"\)\?\.scale\.setScalar\(headScale\)/);
  const editorSource = readFileSync(new URL("./scene-3d-editor.tsx", import.meta.url), "utf8");
  assert.match(editorSource, /buildSkinnedFigure\(THREE, skClone, xbotAsset, color, preset\.headScale \?\? 1\)/);
  assert.match(editorSource, /buildMannequinFigure\(THREE, color, preset\.headScale \?\? 1\)/);
});
