import assert from "node:assert/strict";
import test from "node:test";

import { finalTextSkillResult } from "./skill-run-presentation.ts";

const run = (status, artifacts, steps = []) => ({
  id: "run-1",
  skillId: "skill-1",
  entryPoint: "studio",
  status,
  progress: status === "succeeded" ? 100 : 50,
  revision: 1,
  artifacts,
  steps,
});

test("returns the explicit final Markdown and omits planning text", () => {
  const result = finalTextSkillResult(run("succeeded", [
    { id: "plan", type: "text", role: "draft", text: "internal plan" },
    { id: "legacy", type: "text", text: "unlabelled trace" },
    { id: "final", type: "text", role: "final", isFinal: true, text: "# 最终分析\n\n正文" },
  ]));
  assert.equal(result, "# 最终分析\n\n正文");
});

test("legacy succeeded text without final labels still renders normally", () => {
  assert.equal(finalTextSkillResult(run("succeeded", [
    { id: "legacy", type: "text", content: "  旧版文本结果  " },
  ])), "旧版文本结果");
});

test("mixed text and file or media outputs keep the rich run panel", () => {
  for (const type of ["file", "image", "video", "audio"]) {
    assert.equal(finalTextSkillResult(run("succeeded", [
      { id: "text", type: "text", role: "final", text: "summary" },
      { id: type, type, role: "final", url: `https://cdn.example/${type}` },
    ])), "");
  }
});

test("active and failed runs never render as completed text replies", () => {
  for (const status of ["queued", "running", "waiting_input", "waiting_confirmation", "failed", "cancelled"]) {
    assert.equal(finalTextSkillResult(run(status, [
      { id: "text", type: "text", role: "final", text: "not ready" },
    ])), "");
  }
});

test("duplicate final text from top-level and step artifacts appears once", () => {
  const artifact = { id: "same", type: "text", role: "final", isFinal: true, text: "only once" };
  assert.equal(finalTextSkillResult(run("succeeded", [artifact], [
    { id: "step", status: "succeeded", artifacts: [artifact] },
  ])), "only once");
});
