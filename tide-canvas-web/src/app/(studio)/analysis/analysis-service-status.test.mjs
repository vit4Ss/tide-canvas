import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("./analysis-workbench.tsx", import.meta.url), "utf8");
const tree = ts.createSourceFile("workbench.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "AnalysisWorkbench");
const effects = component.body.statements.filter(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(tree) === "useEffect");
const statusEffect = effects.find(node => node.getText(tree).includes("socialAnalysisApi.status()"));
const ownerEffect = effects.find(node => node.getText(tree).includes("previousOwnerRef.current"));
const recheck = component.body.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations[0].name.getText(tree) === "recheckService");
const code = ts.transpileModule(`globalThis.render = () => { ${ownerEffect.getText(tree)} ${statusEffect.getText(tree)} }; ${recheck.getText(tree)} globalThis.recheck = recheckService;`, {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText;
const settle = () => new Promise(resolve => setImmediate(resolve));

function setup() {
  const calls = [];
  let cursor = 0;
  const slots = [];
  const snapshot = {id: "existing-snapshot"};
  const context = vm.createContext({
    ownerUserId: "owner", previousOwnerRef: {current: "owner"}, statusRefresh: 0,
    tab: "breakdown", result: snapshot, url: "https://example.com/account",
    setStatus: value => { context.status = value; },
    setStatusError: value => { context.statusError = value; },
    setStatusChecking: value => { context.statusChecking = value; },
    setStatusRefresh: update => { context.statusRefresh = update(context.statusRefresh); },
    setError: value => { context.error = value; },
    socialAnalysisApi: {status: async () => {
      calls.push("status");
      return context.response;
    }},
    useEffect: (callback, dependencies) => {
      const index = cursor++;
      const previous = slots[index];
      if (previous && dependencies.every((value, i) => Object.is(value, previous.dependencies[i]))) return;
      previous?.cleanup?.();
      slots[index] = {dependencies, cleanup: callback()};
    },
  });
  vm.runInContext(code, context);
  return {context, calls, snapshot, render: () => { cursor = 0; context.render(); }};
}

test("service recheck fetches the current price without clearing the account snapshot or input", async () => {
  const {context, calls, snapshot, render} = setup();
  context.response = {success: true, data: {enabled: true, configured: true, pointCost: 1}};
  render(); await settle();
  assert.equal(context.status.pointCost, 1);
  context.response = {success: true, data: {enabled: true, configured: true, pointCost: 8}};
  context.recheck(); render(); await settle();
  assert.equal(calls.length, 2);
  assert.equal(context.status.pointCost, 8);
  assert.equal(context.result, snapshot);
  assert.equal(context.url, "https://example.com/account");
  assert.equal(context.statusChecking, false);
});

test("invalid or missing pricing disables new executions, and recheck recovers", async () => {
  for (const pointCost of [undefined, 0, -1, 1.5, 100001, "1"]) {
    const {context, render} = setup();
    context.response = {success: true, data: {enabled: true, configured: true, pointCost}};
    render(); await settle();
    assert.equal(context.status, null);
    assert.equal(context.statusError, true);
    context.response = {success: true, data: {enabled: true, configured: true, pointCost: 2}};
    context.recheck(); render(); await settle();
    assert.equal(context.status.pointCost, 2);
    assert.equal(context.statusError, false);
  }
});

test("late configuration responses cannot replace the price from a newer recheck", async () => {
  const {context, render} = setup();
  const pending = [];
  context.socialAnalysisApi.status = () => new Promise(resolve => pending.push(resolve));
  render(); await settle();
  context.recheck(); render(); await settle();
  pending[1]({success: true, data: {enabled: true, configured: true, pointCost: 8}});
  await settle();
  pending[0]({success: true, data: {enabled: true, configured: true, pointCost: 1}});
  await settle();
  assert.equal(context.status.pointCost, 8);
  assert.equal(context.statusChecking, false);
});
