import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { shouldKeepSocialRequest } from "./billing-retry.ts";

const source = readFileSync(new URL("./analysis-workbench.tsx", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const edit = source.slice(source.indexOf("  const reEditRun ="), source.indexOf("\n  // ARIA tabs"));
const inspect = source.slice(source.indexOf("  const inspect ="), source.indexOf("  const performRunAction ="));
const restore = source.slice(source.indexOf("  const restoreActivityRecord ="), source.indexOf("  const latestActivity ="));
const availability = source.slice(source.indexOf("  const analysisPointCost ="), source.indexOf("  const previousOwnerRef ="));
const code = ts.transpileModule(`${restore}\n${edit}\n${inspect}\nglobalThis.restore = restoreActivityRecord; globalThis.edit = reEditRun; globalThis.inspect = inspect; globalThis.availability = () => { ${availability}\n return {analysisInsufficient, downloadInsufficient}; };`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

function setup(overrides = {}) {
  const calls = { archives: 0, starts: 0, resumes: [], refreshes: 0 };
  let requestSerial = 0;
  const context = vm.createContext({
    result: { kind: "account", platform: "bilibili", recordId: "paid", pointCost: 1, sourceUrl: "https://space.bilibili.com/1?from=share", fetchedAt: "2026-09-05" },
    user: {points: 10},
    analysisEpochRef: {current: 1}, downloadEpochRef: {current: 1}, downloadBusyRef: {current: false},
    inspectBusyRef: {current: false}, inspectEpochRef: {current: 1}, inspectRequestRef: {current: null},
    ownerUserId: "owner", kind: "account", url: "https://space.bilibili.com/1", analysisPointCost: 1,
    pendingInspectKey: "", pendingDownloadKey: "", downloadSource: "https://youtu.be/1234567890a", extractDownloadURL: value => value,
    downloadResult: null, historicalRecord: null, downloadedPreviewUrl: "", downloaderCapabilities: {pointCost: 1}, downloadClock: Date.now(),
    shouldKeepSocialRequest, crypto: {randomUUID: () => `request-${++requestSerial}`},
    setLoading() {}, setStatusRefresh() {}, setHistoryRefresh() {},
    clearHistoricalView() {}, setHistoricalRecord() {}, setDownloadBusy() {},
    isSocialInspectSnapshot: data => Boolean(data?.works),
    useAuthStore: {getState: () => ({user: {id: "owner"}})},
    ensureSession: async () => true,
    refreshBalance: async () => { calls.refreshes++; },
    socialAnalysisApi: {},
    fileApi: { saveFromUrl: async () => { calls.archives++; throw new Error("unexpected archive"); } },
    skillRun: {
      loading: false,
      start: async (request) => { calls.starts++; calls.request = request; return {id: "run"}; },
      resume: async (id) => { calls.resumes.push(id); return {id}; },
      clear: () => { calls.cleared = true; },
    },
    setURL: value => { calls.url = value; }, setKind() {}, setTab() {}, setSelectedWork() {},
    status: {enabled: true, configured: true, pointCost: 1},
    ...overrides,
  });
  context.setError = value => { calls.error = value; };
  context.setResult = value => { context.result = value; };
  context.setPendingInspectKey = value => { context.pendingInspectKey = value; };
  vm.runInContext(code, context);
  Object.defineProperty(context, "retryingInspection", {get: () => context.pendingInspectKey === `${context.ownerUserId}:${context.kind}:${context.url.trim()}`});
  Object.defineProperty(context, "analysisInsufficient", {get: () => context.availability().analysisInsufficient});
  return { context, calls };
}

test("an inspection retry after a gateway timeout uses the original key at zero balance", async () => {
  for (const code of [0, 200, 408, 429, 500, 502, 503, 504]) {
    const {context, calls} = setup();
    const keys = [];
    const snapshot = {...context.result, works: []};
    context.socialAnalysisApi.inspect = async request => {
      keys.push(request.clientRequestId);
      context.user.points = 0;
      return keys.length === 1 ? {success: false, code} : {success: true, data: snapshot};
    };
    assert.equal(context.availability().analysisInsufficient, false);
    await context.inspect();
    assert.equal(context.availability().analysisInsufficient, false);
    await context.inspect();
    assert.equal(keys[0], keys[1], `new charge key after ${code}`);
    assert.equal(context.pendingInspectKey, "");
    assert.equal(context.result.recordId, "paid");
    assert.equal(calls.starts, 0);
  }
});

test("pending-operation retries never waive the balance gate for a different URL or owner", () => {
  const {context} = setup({user: {points: 0}});
  context.pendingInspectKey = `owner:account:${context.url}`;
  context.pendingDownloadKey = `owner:${context.downloadSource}`;
  assert.equal(context.availability().analysisInsufficient, false);
  assert.equal(context.availability().downloadInsufficient, false);
  context.ownerUserId = "another-owner";
  assert.equal(context.availability().analysisInsufficient, true);
  assert.equal(context.availability().downloadInsufficient, true);
  context.ownerUserId = "owner";
  context.url += "/2";
  context.downloadSource += "2";
  assert.equal(context.availability().analysisInsufficient, true);
  assert.equal(context.availability().downloadInsufficient, true);
});

test("a session change while inspection awaits authentication never sends the old request", async () => {
  const {context} = setup();
  context.ensureSession = async () => { context.inspectEpochRef.current++; return true; };
  context.socialAnalysisApi.inspect = async () => { throw new Error("stale request was sent"); };
  await context.inspect();
  assert.equal(context.inspectRequestRef.current, null);
});

test("re-edit keeps the original URL but returns to a new explicitly priced analysis", () => {
  const { context, calls } = setup();
  context.skillRun.run = { input: {prompt: "focus", parameters: {analysisMode: "video", sourceUrl: "https://example.com/video?share=1"}} };
  context.edit();
  assert.equal(calls.url, "https://example.com/video?share=1");
  assert.equal(context.result, null);
  assert.equal(calls.cleared, true);
  assert.ok(calls.error.includes("页面价格"));
  assert.equal(calls.starts, 0);
});

test("Enter and history refresh cannot bypass unavailable pricing, disabled services or insufficient points", async () => {
  for (const override of [{status: null}, {status: {enabled: false, configured: true, pointCost: 1}}, {status: {enabled: true, configured: false, pointCost: 1}}, {user: {points: 0}}]) {
    const {context, calls} = setup(override);
    const previous = context.result;
    context.socialAnalysisApi.inspect = async () => { throw new Error("blocked request reached the server"); };
    await context.inspect();
    assert.equal(context.result, previous, "blocked execution erased the current snapshot");
    assert.equal(context.inspectRequestRef.current, null);
    assert.ok(calls.error);
  }
});

test("an uncertain paid inspection can retry its original key even if pricing becomes unavailable", async () => {
  const {context} = setup();
  const requests = [];
  const snapshot = {...context.result, works: []};
  context.socialAnalysisApi.inspect = async request => {
    requests.push(request);
    return requests.length === 1 ? {success: false, code: 502} : {success: true, data: snapshot};
  };
  await context.inspect();
  context.user.points = 0;
  context.status = null;
  await context.inspect();
  assert.equal(requests.length, 2);
  assert.equal(requests[0].clientRequestId, requests[1].clientRequestId);
  assert.equal(context.result, snapshot);
});

test("account inspection displays the paid platform snapshot without starting or loading an AI report", async () => {
  const {context, calls} = setup();
  const snapshot = {...context.result, works: [{id: "work", stats: {like: "9"}}]};
  context.socialAnalysisApi.inspect = async () => ({success: true, data: snapshot});
  await context.inspect();
  assert.equal(context.result, snapshot);
  assert.equal(calls.starts, 0);
  assert.equal(calls.archives, 0);
  assert.deepEqual(calls.resumes, []);
  assert.equal(calls.refreshes, 1);
});

test("refresh and history selection restore exact snapshots without hidden AI polling or new API calls", async () => {
  for (const kind of ["account", "content"]) {
    for (const automatic of [true, false]) {
      const {context, calls} = setup();
      const snapshot = {...context.result, kind, works: [{id: "work", stats: {like: "9"}}]};
      const record = {id: "saved", userId: "owner", type: "analysis", snapshot, analysisRunId: "old-running-report"};
      context.socialAnalysisApi.inspect = async () => { throw new Error("history must not re-inspect"); };
      await context.restore(record, automatic);
      assert.equal(context.result, snapshot);
      assert.equal(calls.starts, 0);
      assert.equal(calls.archives, 0);
      assert.deepEqual(calls.resumes, []);
      assert.equal(calls.cleared, true);
    }
  }
});
