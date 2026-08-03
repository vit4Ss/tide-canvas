import assert from "node:assert/strict";
import test from "node:test";
import {
  canvasLaunchCanSubmit,
  canvasLaunchKindFor,
  canvasLaunchNeedsDirectModel,
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
