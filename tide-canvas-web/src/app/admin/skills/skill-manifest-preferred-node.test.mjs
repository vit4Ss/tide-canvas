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
const code = ts.transpileModule(`${extractFunction("normalizeGeneratedPreferredNodeType")}\n${extractFunction("reconcileGeneratedInputPreset")}\n${extractFunction("normalizeGeneratedStepType")}\n${extractFunction("normalizeGeneratedStepHandler")}\n${extractFunction("inferGeneratedAnalysisHandler")}\n${extractFunction("normalizeGeneratedStepOutputType")}\n${extractFunction("normalizeGeneratedOutputRole")}\n${extractFunction("canonicalizeGeneratedMediaAnalysisManifest")}\nglobalThis.normalize = normalizeGeneratedPreferredNodeType;\nglobalThis.reconcile = reconcileGeneratedInputPreset;\nglobalThis.normalizeStepType = normalizeGeneratedStepType;\nglobalThis.normalizeHandler = normalizeGeneratedStepHandler;\nglobalThis.inferAnalysisHandler = inferGeneratedAnalysisHandler;\nglobalThis.normalizeOutputType = normalizeGeneratedStepOutputType;\nglobalThis.normalizeOutputRole = normalizeGeneratedOutputRole;\nglobalThis.canonicalizeAnalysis = canonicalizeGeneratedMediaAnalysisManifest;`, {
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
  assert.equal(context.normalizeHandler(undefined, "analyze_video"), "analyze_video");
  assert.equal(context.normalizeHandler(undefined, "video-analysis"), "analyze_video");
  assert.equal(context.normalizeHandler("videoAnalysis", "analysis"), "analyze_video");
  assert.equal(context.normalizeHandler(undefined, "unknown"), "");
  assert.equal(context.inferAnalysisHandler({ "x-asset-types": ["video"] }, "text"), "analyze_video");
  assert.equal(context.inferAnalysisHandler({ "x-asset-types": ["image"] }, "text"), "analyze_image");
  assert.equal(context.inferAnalysisHandler({ "x-asset-types": ["video", "audio"] }, "text"), "");
  assert.equal(context.inferAnalysisHandler({ required: ["url"], properties: { url: { type: "string" } } }, "text"), "analyze_webpage");
});

test("AI import derives required output types and normalizes result roles", () => {
  assert.equal(context.normalizeOutputType(undefined, "tool", "analyze_video"), "text");
  assert.equal(context.normalizeOutputType("report", "tool", "analyze_image"), "text");
  assert.equal(context.normalizeOutputType(undefined, "generate", "text_to_video"), "video");
  assert.equal(context.normalizeOutputType(undefined, "tool", "render_docx"), "file");
  assert.equal(context.normalizeOutputType(undefined, "text", ""), "text");
  assert.equal(context.normalizeOutputRole("result"), "final");
  assert.equal(context.normalizeOutputRole("working"), "intermediate");
  assert.equal(context.normalizeOutputRole("unexpected"), undefined);
});

test("single-media review skills use one analysis call instead of a paid polish chain", () => {
  const generated = { steps: [
    { key: "review", type: "analysis", handler: "analyze_video", prompt: "{{prompt}}" },
    { key: "polish", type: "llm", handler: "skill_text_completion", prompt: "{{previous}}" },
  ] };
  const agent = context.canonicalizeAnalysis(generated, "agent", "video", "text");
  assert.equal(agent.steps, undefined);
  const tool = context.canonicalizeAnalysis(generated, "tool", "video", "text");
  assert.equal(tool.steps.length, 1);
  assert.equal(tool.steps[0].handler, "analyze_video");
  assert.equal(tool.steps[0].outputRole, "final");
  const webpage = context.canonicalizeAnalysis({ steps: [{ type: "tool", handler: "analyze_webpage" }] }, "agent", "webpage", "text");
  assert.equal(webpage.steps.length, 1);
  const generator = { steps: [{ type: "tool", handler: "analyze_video" }, { type: "generate", handler: "text_to_video" }] };
  assert.equal(context.canonicalizeAnalysis(generator, "agent", "video", "text"), generator);
});
