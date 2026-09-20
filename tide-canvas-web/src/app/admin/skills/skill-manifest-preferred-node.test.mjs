import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const raw = readFileSync(new URL("./_components/skill-manifest-ai-control.tsx", import.meta.url), "utf8");
const source = ts.createSourceFile("control.tsx", raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const extractFunction = (name) => {
  const fn = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(fn, `${name} function missing`);
  return fn.getText(source).replace(/^export /, "");
};
const code = ts.transpileModule(`${extractFunction("normalizeGeneratedPreferredNodeType")}\n${extractFunction("reconcileGeneratedInputPreset")}\n${extractFunction("normalizeGeneratedStepType")}\nglobalThis.normalize = normalizeGeneratedPreferredNodeType;\nglobalThis.reconcile = reconcileGeneratedInputPreset;\nglobalThis.normalizeStepType = normalizeGeneratedStepType;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const context = {};
vm.createContext(context);
vm.runInContext(code, context);

test("AI preferredNodeType keeps only canvas concept-node hints", () => {
  for (const value of ["", "character", "scene"]) assert.equal(context.normalize(value), value);
  assert.equal(context.normalize(" scene "), "scene");
  assert.equal(context.normalize(" character\n"), "character");
  for (const value of ["image", "video", "text", "file", "audio", null, 1, {}, []]) assert.equal(context.normalize(value), undefined);
});

test("AI import reconciles semantic media inputs from its chosen analysis handler", () => {
  assert.equal(context.reconcile("file", { steps: [{ type: "tool", handler: "analyze_video" }] }), "video");
  assert.equal(context.reconcile("text", { steps: [{ type: "tool", handler: "analyze_audio" }] }), "audio");
  assert.equal(context.reconcile("file", { steps: [{ type: "tool", handler: "analyze_webpage" }] }), "webpage");
  assert.equal(context.reconcile("file", { steps: [{ type: "tool", handler: "analyze_image" }] }), "image");
  assert.equal(context.reconcile("images", { steps: [{ type: "tool", handler: "analyze_image" }] }), "images");
  assert.equal(context.reconcile("mixed", { steps: [{ handler: "analyze_image" }, { handler: "analyze_video" }] }), "mixed");
  assert.equal(context.reconcile("file", { steps: [{ type: "tool", handler: "render_docx" }] }), "file");
});

test("AI import derives runtime step types from registered handlers and safe aliases", () => {
  assert.equal(context.normalizeStepType("video", "analyze_video"), "tool");
  assert.equal(context.normalizeStepType("analysis", "analyze_image"), "tool");
  assert.equal(context.normalizeStepType("image", "text_to_image"), "generate");
  assert.equal(context.normalizeStepType("llm", "skill_text_completion"), "text");
  assert.equal(context.normalizeStepType("confirmation", ""), "approval");
  assert.equal(context.normalizeStepType("user-input", ""), "input");
  assert.equal(context.normalizeStepType("unknown", ""), undefined);
});
