import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  normalizedScene3DMotionPoseAt,
  normalizeScene3DMotion,
  sampleScene3DMotion,
  scene3DMotionPoseAt,
  scene3DMotionPresetPoses,
} from "./scene-3d-motion.ts";

const editorSource = readFileSync(new URL("./scene-3d-editor.tsx", import.meta.url), "utf8");

const motion = {
  duration: 4,
  easing: "linear",
  loop: false,
  showPath: true,
  keyframes: [
    { id: "a", name: "A", time: 0, position: [0, 1, 4], target: [0, 1, 0], fov: 50 },
    { id: "b", name: "B", time: 4, position: [0, 1, 2], target: [0, 1, 0], fov: 40 },
  ],
};

test("normalizes unsafe motion data and sorts keyframes", () => {
  const result = normalizeScene3DMotion({
    duration: 999,
    easing: "bad",
    keyframes: [
      { id: "late", name: "x".repeat(200), time: 70, position: [1e100, -1e100, 3], target: [0, 0, 0], fov: 999 },
      { id: "early", time: -1, position: [0, 1, 2], target: [0, 1, 0], fov: 50 },
    ],
  });
  assert.equal(result.duration, 60);
  assert.equal(result.easing, "easeInOut");
  assert.deepEqual(result.keyframes.map((frame) => frame.id), ["early", "late"]);
  assert.equal(result.keyframes[0].time, 0);
  assert.equal(result.keyframes[1].time, 60);
  assert.equal(result.keyframes[1].fov, 120);
  assert.deepEqual(result.keyframes[1].position, [10_000, -10_000, 3]);
  assert.equal(result.keyframes[1].name.length, 80);
});

test("deduplicates ids and caps untrusted keyframe collections", () => {
  const keyframes = Array.from({ length: 140 }, (_, index) => ({
    id: "same",
    name: `frame ${index}`,
    time: index / 3,
    position: [index, 1, 4],
    target: [0, 1, 0],
    fov: 50,
  }));
  const result = normalizeScene3DMotion({ ...motion, duration: 60, keyframes });
  assert.equal(result.keyframes.length, 120);
  assert.equal(new Set(result.keyframes.map((frame) => frame.id)).size, 120);

  const collision = normalizeScene3DMotion({
    ...motion,
    keyframes: [
      { ...motion.keyframes[0], id: "same_2" },
      { ...motion.keyframes[0], id: "same" },
      { ...motion.keyframes[0], id: "same" },
    ],
  });
  assert.equal(new Set(collision.keyframes.map((frame) => frame.id)).size, 3);
});

test("interpolates camera position, target and FOV by keyframe time", () => {
  const pose = scene3DMotionPoseAt(motion, 2);
  assert.ok(pose);
  assert.deepEqual(pose.position, [0, 1, 3]);
  assert.deepEqual(pose.target, [0, 1, 0]);
  assert.equal(pose.fov, 45);
  assert.deepEqual(normalizedScene3DMotionPoseAt(normalizeScene3DMotion(motion), 2), pose);
  assert.equal(sampleScene3DMotion(motion, 5).length, 5);
});

test("motion presets produce useful push, truck and orbit endpoints", () => {
  const pose = { position: [0, 1, 4], target: [0, 1, 0], fov: 50 };
  const push = scene3DMotionPresetPoses("pushIn", pose);
  assert.ok(push[1].position[2] < push[0].position[2]);

  const truck = scene3DMotionPresetPoses("truckRight", pose);
  assert.notEqual(truck[1].position[0], truck[0].position[0]);
  assert.equal(truck[1].position[0] - truck[0].position[0], truck[1].target[0] - truck[0].target[0]);

  const orbit = scene3DMotionPresetPoses("orbitLeft", pose);
  const startDistance = Math.hypot(pose.position[0] - pose.target[0], pose.position[2] - pose.target[2]);
  const endDistance = Math.hypot(orbit[1].position[0] - pose.target[0], orbit[1].position[2] - pose.target[2]);
  assert.ok(Math.abs(startDistance - endDistance) < 1e-9);

  const degeneratePose = { position: [0, 2, 0], target: [0, 2, 0], fov: 50 };
  const degeneratePush = scene3DMotionPresetPoses("pushIn", degeneratePose);
  const degenerateTruck = scene3DMotionPresetPoses("truckRight", degeneratePose);
  assert.notDeepEqual(degeneratePush[1].position, degeneratePush[0].position);
  assert.notDeepEqual(degenerateTruck[1].position, degenerateTruck[0].position);
});

test("director editor traps focus and isolates global shortcuts from controls", () => {
  assert.match(editorSource, /useFocusTrap<HTMLDivElement>\(true\)/);
  assert.match(editorSource, /role="dialog"[\s\S]*aria-modal="true"[\s\S]*aria-label="3D 导演台"/);
  assert.match(editorSource, /closest\?\.\("button, a\[href\], \[role='button'\], \[role='listbox'\]"\)/);
  assert.match(editorSource, /disabled=\{loading\}[\s\S]*aria-pressed=\{piloting\}/);
  assert.match(editorSource, /max-w-full[\s\S]*overflow-x-auto/);
});
