import assert from "node:assert/strict";
import test from "node:test";
import {
  canvasLaunchCanSubmit,
  canvasLaunchKindFor,
  canvasLaunchNeedsDirectModel,
  canvasLauncherAllowsDirectModel,
} from "./canvas-launch-policy.ts";

test("only a launch without Skill requires a direct model", () => {
  assert.equal(canvasLaunchKindFor(null), "direct");
  assert.equal(canvasLaunchNeedsDirectModel(null), true);
  assert.equal(canvasLaunchNeedsDirectModel({ kind: "preset" }), false);
  assert.equal(canvasLaunchNeedsDirectModel({ kind: "agent" }), false);
  assert.equal(canvasLaunchCanSubmit(null, ""), false);
  assert.equal(canvasLaunchCanSubmit(null, "image-model"), true);
  assert.equal(canvasLaunchCanSubmit({ kind: "preset" }, ""), true);
  assert.equal(canvasLaunchCanSubmit({ kind: "agent" }, undefined), true);
});

test("legacy workflow Skills use the agent handoff", () => {
  assert.equal(canvasLaunchKindFor({ kind: "workflow" }), "agent");
  assert.equal(canvasLaunchNeedsDirectModel({ kind: "workflow" }), false);
});

test("tool and unknown Skills cannot leak into the canvas launch flow", () => {
  assert.equal(canvasLaunchKindFor({ kind: "tool" }), null);
  assert.equal(canvasLaunchKindFor({ kind: "other" }), null);
  assert.equal(canvasLaunchNeedsDirectModel({ kind: "tool" }), false);
  assert.equal(canvasLaunchCanSubmit({ kind: "tool" }, "video-model"), false);
});

test("the project launcher only exposes explicit video models for direct generation", () => {
  assert.equal(canvasLauncherAllowsDirectModel({ type: "video" }), true);
  assert.equal(canvasLauncherAllowsDirectModel({ type: "image" }), false);
  assert.equal(canvasLauncherAllowsDirectModel({ type: "audio" }), false);
  assert.equal(canvasLauncherAllowsDirectModel({ type: "text" }), false);
  assert.equal(canvasLauncherAllowsDirectModel({}), false);
  assert.equal(canvasLauncherAllowsDirectModel(null), false);
});
