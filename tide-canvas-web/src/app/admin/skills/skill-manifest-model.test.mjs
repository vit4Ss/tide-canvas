import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const raw = readFileSync(new URL("./_components/skill-manifest-ai-control.tsx", import.meta.url), "utf8");
const source = ts.createSourceFile("control.tsx", raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = ["parseModelConfig", "textModels"].map((name) => {
  const fn = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(fn, `${name} function missing`);
  return fn.getText(source);
});
const code = ts.transpileModule(functions.join("\n") + "\nglobalThis.selectModels = textModels;", {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const context = {};
vm.createContext(context);
vm.runInContext(code, context);
const select = (models) => Array.from(context.selectModels(models), (model) => model.modelId);
const textModel = { type: "text", modelId: "earlier-text", config: "{}" };
const primary = { type: "text", modelId: "primary-text", config: '{"aiOptimizePrimary": true}' };

test("Manifest generation uses only the configured primary, regardless of catalog order", () => {
  assert.deepEqual(select([textModel, primary]), ["primary-text"]);
  assert.deepEqual(select([primary, textModel]), ["primary-text"]);
  assert.deepEqual(select([textModel, { ...primary, modelId: "new-primary" }]), ["new-primary"]);
});

test("an unavailable primary cannot silently send Manifest generation to another provider", () => {
  assert.deepEqual(select([textModel, { ...primary, config: '{"aiOptimizePrimary":true,"availabilityStatus":"maintenance"}' }]), []);
  assert.deepEqual(select([textModel, { ...primary, supportedHandlers: ["assistant_chat"] }]), []);
});

test("installations without a primary retain compatible text-model defaults", () => {
  assert.deepEqual(select([
    { ...primary, type: "image" },
    textModel,
    { ...textModel, modelId: "maintenance", config: '{"availabilityStatus":"maintenance"}' },
    { ...textModel, modelId: "incompatible", supportedHandlers: ["text_to_image"] },
    { ...textModel, modelId: "second-text", config: "malformed JSON" },
  ]), ["earlier-text", "second-text"]);
});
