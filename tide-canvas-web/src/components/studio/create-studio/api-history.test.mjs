import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

function load(relative, require = () => ({}), globals = {}) {
  const source = readFileSync(new URL(relative, import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  const loaded = { exports: {} };
  runInNewContext(code, { exports: loaded.exports, module: loaded, require, ...globals });
  return loaded.exports;
}
const constants = load("./constants.ts");
const types = load("../../../types/ai.ts");
const { histItemsFromTasks } = load("./utils.ts", (name) => name === "./constants" ? constants : name === "@/types/ai" ? types : {});
const { mergeInitialStudioHistory, nextHistoryRequest } = load("./history-merge.ts");
const convert = (tasks) => JSON.parse(JSON.stringify(histItemsFromTasks(tasks)));
const base = { id: "1234567890123456789", handler: "text_to_image", isApiCall: true, modelName: "Test", input: { prompt: "my prompt", n: 2 }, resultMeta: {}, resultUrl: "", createTime: "2026-09-19T01:00:00Z", status: 0, progress: 30 };

test("API processing transitions to multiple results once, preserving UI history", () => {
  const ui = convert([{ ...base, id: "old", isApiCall: false, status: 1, resultUrl: "https://cdn.test/old.png" }]);
  const pending = convert([base]);
  assert.equal(pending[0].status, "processing");
  assert.equal(pending[0].progress, 30);
  assert.equal(pending[0].url, undefined);
  const done = convert([{ ...base, status: 1, resultMeta: { urls: ["https://cdn.test/a.png", "https://cdn.test/b.png"] } }]);
  assert.equal(done.length, 2);
  const merged = mergeInitialStudioHistory([...ui, ...pending], done);
  assert.equal(merged.length, 3);
  assert.equal(merged.filter((h) => h.status === "processing").length, 0);
  assert.ok(merged.filter((h) => h.isApiCall).every((h) => h.prompt === "my prompt" && h.params.count === 2));
});

test("API text, failed, cancelled and 3D tasks remain visible without fake image results", () => {
  for (const handler of ["assistant_chat", "skill_text_completion"]) {
    const [row] = convert([{ ...base, handler, status: 1, resultMeta: { text: "A real reply" } }]);
    assert.equal(row.isText, true); assert.equal(row.resultText, "A real reply"); assert.equal(row.status, "success");
  }
  const [failed] = convert([{ ...base, status: 2, errorMsg: "渠道维护中" }]);
  assert.equal(failed.errorMsg, "渠道维护中"); assert.equal(failed.status, "failed");
  const [cancelled] = convert([{ ...base, status: 3, resultUrl: "https://cdn.test/temporary.png" }]);
  assert.equal(cancelled.status, "cancelled"); assert.equal(cancelled.url, undefined);
  const [threeD] = convert([{ ...base, status: 1, handler: "generate_3d", resultMeta: { assets: [{ type: "glb", url: "https://cdn.test/a.glb" }] } }]);
  assert.equal(threeD.type, "3d"); assert.equal(threeD.isApiCall, true); assert.equal(threeD.assets.length, 1);
  assert.equal(convert([{ ...base, isApiCall: false, handler: "assistant_chat", status: 1, resultMeta: { text: "legacy" } }]).length, 0);
});

test("API reference aliases are retained for previews and missing media is reported", () => {
  const [row] = convert([{ ...base, handler: "image_to_video", input: { prompt: "move", imageUrls: ["https://cdn.test/ref.png"], duration: 10 }, status: 1, resultUrl: "https://cdn.test/out.mp4" }]);
  assert.deepEqual(row.params.imageRefs, ["https://cdn.test/ref.png"]); assert.equal(row.params.dur, "10s");
  const [missing] = convert([{ ...base, status: 1, resultMeta: "broken-json" }]);
  assert.equal(missing.status, "failed"); assert.match(missing.errorMsg, /不可用/);
});

test("an old polling response cannot resurrect a deleted API task", () => {
  const items = convert([{ ...base, status: 1, resultUrl: "https://cdn.test/a.png" }]);
  const excluded = new Set([`task-${base.id}`]);
  assert.equal(mergeInitialStudioHistory([], items, excluded).length, 0);
  excluded.clear();
  assert.equal(mergeInitialStudioHistory([], items, excluded).length, 1);
});

test("late processing snapshots cannot erase completed output or regress progress", () => {
  const pending = convert([base]);
  for (const finished of [
    { ...base, status: 1, resultMeta: { urls: ["https://cdn.test/a.png", "https://cdn.test/b.png"] } },
    { ...base, status: 2, errorMsg: "失败" },
    { ...base, status: 3 },
    { ...base, handler: "assistant_chat", status: 1, resultMeta: { text: "done" } },
  ]) {
    const current = convert([finished]);
    assert.deepEqual(JSON.parse(JSON.stringify(mergeInitialStudioHistory(current, pending))), current);
  }
  const newer = convert([{ ...base, progress: 70 }]);
  assert.equal(mergeInitialStudioHistory(newer, pending)[0].progress, 70);
  assert.equal(mergeInitialStudioHistory(pending, newer)[0].progress, 70);
});

test("API history polling does not overlap, refreshes balance and drops stale-owner responses", async () => {
  const effects = [];
  const intervals = [];
  const listeners = new Map();
  let owner = "owner-a", requests = 0, balances = 0, updates = 0, moreHistory = 0;
  let release;
  let current = [];
  const state = () => ({ user: { id: owner } });
  const auth = Object.assign((selector) => selector(state()), { getState: state });
  const removed = { current: new Set() };
  const api = {
    listTasks: () => { requests++; return new Promise((resolve) => { release = resolve; }); },
    getTask: async () => { throw Error("not expected"); },
  };
  const deps = {
    react: { useRef: (value) => ({ current: value }), useEffect: (effect) => effects.push(effect) },
    "@/lib/api": { aiApi: api }, "@/stores/use-auth-store": { useAuthStore: auth },
    "./utils": { histItemsFromTasks }, "./history-merge": { mergeInitialStudioHistory },
  };
  const doc = { hidden: false, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name) => listeners.delete(name) };
  const { useAPIHistorySync } = load("./use-api-history-sync.ts", (name) => deps[name], {
    setInterval: (fn) => { intervals.push(fn); return 1; }, clearInterval: () => {},
    AbortController, setTimeout: () => 1, clearTimeout: () => {},
    document: doc, window: doc,
  });
  useAPIHistorySync([], (updater) => { updates++; current = updater(current); }, removed, async () => { balances++; }, (restart) => { assert.equal(restart,true); moreHistory++; });
  effects[0]();
  const cleanup = effects[1]();
  const flush = () => new Promise(setImmediate);
  intervals[0](); intervals[0]();
  assert.equal(requests, 1);
  release({ success: true, data: { records: [base], total: 25 } }); await flush();
  assert.equal(updates, 1); assert.equal(balances, 1); assert.equal(current.length, 1);
  assert.equal(moreHistory, 1);
  intervals[0](); owner = "owner-b";
  release({ success: true, data: { records: [{ ...base, id: "private-a" }] } }); await flush();
  assert.equal(updates, 1); assert.equal(balances, 1);
  doc.hidden = true; intervals[0](); assert.equal(requests, 2);
  doc.hidden = false; cleanup(); intervals[0](); assert.equal(requests, 2);
  assert.equal(listeners.size, 0);
});

test("API polling aborts a stalled request, retries next cycle and cancels on unmount", async () => {
  const effects = [], intervals = [], signals = [];
  const deadlines = new Map(), listeners = new Map();
  let timeoutID = 0, requests = 0, updates = 0, balances = 0;
  let lateResponse;
  const state = { user: { id: "owner" } };
  const api = {
    listTasks: (_query, signal) => {
      signals.push(signal); requests++;
      if (requests === 2) return Promise.resolve({ success:true, data:{ records:[base] } });
      return new Promise((resolve) => {
        lateResponse = resolve;
        signal.addEventListener("abort", () => resolve({ success:false, code:0 }), { once:true });
      });
    },
    getTask: async () => { throw Error("unexpected task query"); },
  };
  const deps = {
    react: { useRef: (value) => ({ current:value }), useEffect: (effect) => effects.push(effect) },
    "@/lib/api": { aiApi:api },
    "@/stores/use-auth-store": { useAuthStore:Object.assign((s) => s(state),{ getState:() => state }) },
    "./utils": { histItemsFromTasks }, "./history-merge": { mergeInitialStudioHistory },
  };
  const doc = { hidden:false, addEventListener:(k,fn) => listeners.set(k,fn), removeEventListener:(k) => listeners.delete(k) };
  const { useAPIHistorySync } = load("./use-api-history-sync.ts", (name) => deps[name], {
    AbortController, document:doc, window:doc,
    setInterval:(fn) => { intervals.push(fn); return 1; }, clearInterval:() => {},
    setTimeout:(fn,ms) => { assert.equal(ms,30_000); deadlines.set(++timeoutID,fn); return timeoutID; }, clearTimeout:(id) => deadlines.delete(id),
  });
  useAPIHistorySync([], () => { updates++; }, { current:new Set() }, async (signal) => { assert.equal(signal,signals[1]); balances++; }, () => {});
  effects[0](); const cleanup = effects[1]();
  const flush = () => new Promise(setImmediate);
  intervals[0](); assert.equal(requests,1);
  [...deadlines.values()][0](); await flush();
  assert.equal(signals[0].aborted,true); assert.equal(updates,0); assert.equal(deadlines.size,0);
  intervals[0](); await flush();
  assert.equal(requests,2); assert.equal(updates,1); assert.equal(balances,1);
  intervals[0](); cleanup(); lateResponse({ success:true, data:{ records:[base] } }); await flush();
  assert.equal(signals[2].aborted,true); assert.equal(updates,1); assert.equal(deadlines.size,0);
});

test("retrying failed initial history does not skip the first page", () => {
  const request = (last,loaded) => JSON.parse(JSON.stringify(nextHistoryRequest(last,loaded)));
  assert.deepEqual(request(1,0),{ page:1, append:false });
  assert.deepEqual(request(1,20),{ page:2, append:true });
  assert.deepEqual(request(2,40),{ page:3, append:true });
});

test("changing accounts remounts Studio, while refreshing the same account does not", () => {
  const source = readFileSync(new URL("../create-studio.tsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile("studio.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const wrapper = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "CreateStudio");
  assert.ok(wrapper);
  const code = ts.transpileModule(wrapper.getText(ast), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  let user = { id: "a", points: 10 };
  const loaded = { exports: {} };
  runInNewContext(code, {
    exports: loaded.exports,
    useAuthStore: (selector) => selector({ user }),
    StudioSession: () => {},
    require: () => ({ jsx: (type, props, key) => ({ type, props, key }) }),
  });
  const first = loaded.exports.default();
  user = { id: "a", points: 20 };
  assert.equal(loaded.exports.default().key, first.key);
  user = { id: "b", points: 10 };
  assert.notEqual(loaded.exports.default().key, first.key);
  user = null;
  assert.equal(loaded.exports.default().key, "anonymous");
});
