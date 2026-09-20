import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const raw = readFileSync(new URL("./_components/skill-manifest-ai-control.tsx", import.meta.url), "utf8");
const source = ts.createSourceFile("control.tsx", raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const fn = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "normalizeGeneratedPreferredNodeType");
assert.ok(fn, "normalizer function missing");
const code = ts.transpileModule(`${fn.getText(source).replace(/^export /, "")}\nglobalThis.normalize = normalizeGeneratedPreferredNodeType;`, {
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
