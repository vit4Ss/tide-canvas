import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { shouldKeepSocialRequest } from "./billing-retry.ts";

const source = readFileSync(new URL("./analysis-workbench.tsx", import.meta.url), "utf8").replaceAll("\r\n", "\n");
const start = source.slice(source.indexOf("  const startDeepAnalysis ="), source.indexOf("\n  useEffect(() => {\n    if (!result"));
const edit = source.slice(source.indexOf("  const reEditRun ="), source.indexOf("\n  // ARIA tabs"));
const inspect = source.slice(source.indexOf("  const inspect ="), source.indexOf("  const loadAnalysisSkill ="));
const availability = source.slice(source.indexOf("  const analysisPointCost ="), source.indexOf("  const previousOwnerRef ="));
const code = ts.transpileModule(`${start}\n${edit}\n${inspect}\nglobalThis.start = startDeepAnalysis; globalThis.edit = reEditRun; globalThis.inspect = inspect; globalThis.availability = () => { ${availability}\n return {analysisInsufficient, downloadInsufficient}; };`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

function setup(record = {}, overrides = {}) {
  const calls = { archives: 0, starts: 0, resumes: [], refreshes: 0 };
  let requestSerial = 0;
  const context = vm.createContext({
    result: { kind: "account", platform: "bilibili", recordId: "paid", pointCost: 1, sourceUrl: "https://space.bilibili.com/1?from=share", fetchedAt: "2026-09-05" },
    currentPlatform: "bilibili", currentWork: null, focus: "focus", user: {points: 0},
    analysisBusyRef: { current: false }, analysisEpochRef: {current: 1},
    inspectBusyRef: {current: false}, inspectEpochRef: {current: 1}, inspectRequestRef: {current: null}, pendingAccountAutoRunRef: {current: null},
    ownerUserId: "owner", kind: "account", url: "https://space.bilibili.com/1", analysisPointCost: 1,
    pendingInspectKey: "", pendingDownloadKey: "", downloadSource: "https://youtu.be/1234567890a", extractDownloadURL: value => value,
    downloadResult: null, historicalRecord: null, downloadedPreviewUrl: "", downloaderCapabilities: {pointCost: 1},
    shouldKeepSocialRequest, crypto: {randomUUID: () => `request-${++requestSerial}`},
    setLoading() {}, setStatusRefresh() {}, setHistoryRefresh() {},
    setEditingContentFocus() {}, setArchiving() {}, clearHistoricalView() {},
    ensureSession: async () => true,
    refreshBalance: async () => { calls.refreshes++; },
    loadAnalysisSkill: async () => ({ id: "analysis-skill" }),
    socialAnalysisApi: { record: async () => ({ success: true, data: { pointCost: 1, status: "succeeded", ...record } }) },
    fileApi: { saveFromUrl: async () => { calls.archives++; throw new Error("unexpected archive"); } },
    accountPrompt: () => "prompt",
    skillRun: {
      loading: false,
      start: async (request) => { calls.starts++; calls.request = request; return {id: "run"}; },
      resume: async (id) => { calls.resumes.push(id); return {id}; },
      clear: () => { calls.cleared = true; },
    },
    skillApi: { recordUse: async () => {} },
    setURL: value => { calls.url = value; }, setKind() {}, setFocus() {}, setTab() {}, setSelectedWork() {},
    status: {}, ACCOUNT_DEFAULT_FOCUS: "account", IMAGE_DEFAULT_FOCUS: "image", DEFAULT_FOCUS: "video",
    ...overrides,
  });
  context.setError = context.setStrategyError = value => { calls.error = value; };
  context.setResult = value => { context.result = value; };
  context.setPendingInspectKey = value => { context.pendingInspectKey = value; };
  vm.runInContext(code, context);
  return { context, calls };
}

test("the last point already reserved for analysis includes its report at zero remaining balance", async () => {
  const { context, calls } = setup();
  await context.start();
  assert.equal(calls.starts, 1);
  assert.equal(calls.request.input.parameters.activityRecordId, "paid");
  assert.equal(calls.request.input.parameters.sourceUrl, context.result.sourceUrl);
  assert.equal(context.analysisBusyRef.current, false);
});

test("an inspection retry after a gateway timeout uses the original key at zero balance", async () => {
  for (const code of [0, 200, 408, 429, 500, 502, 503, 504]) {
    const {context, calls} = setup();
    const keys = [];
    const snapshot = {...context.result, works: []};
    context.socialAnalysisApi.inspect = async request => {
      keys.push(request.clientRequestId);
      return keys.length === 1 ? {success: false, code} : {success: true, data: snapshot};
    };
    assert.equal(context.availability().analysisInsufficient, true);
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
  const {context} = setup();
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

test("existing reports resume without starting another task or archiving assets", async () => {
  const { context, calls } = setup({ analysisRunId: "existing-report" });
  await context.start();
  assert.deepEqual(calls.resumes, ["existing-report"]);
  assert.equal(calls.starts, 0);
  assert.equal(calls.archives, 0);
});

test("unpaid history and refunded executions cannot start a report", async () => {
  for (const state of ["legacy", "refunded", "failed"]) {
    const { context, calls } = setup(state === "refunded" ? {refunded: true} : state === "failed" ? {status: "failed"} : {});
    if (state === "legacy") context.result.pointCost = 0;
    await context.start();
    assert.equal(calls.starts, 0);
    assert.equal(calls.archives, 0);
    assert.ok(calls.error);
  }
});

test("an uncertain billing lookup fails closed, and an old account response cannot start a new user's report", async () => {
  const failed = setup();
  failed.context.socialAnalysisApi.record = async () => ({ success: false, message: "offline" });
  await failed.context.start();
  assert.equal(failed.calls.starts, 0);
  assert.equal(failed.calls.error, "offline");

  const stale = setup();
  stale.context.socialAnalysisApi.record = async () => {
    stale.context.analysisEpochRef.current++;
    return {success: true, data: {pointCost: 1, status: "succeeded"}};
  };
  await stale.context.start();
  assert.equal(stale.calls.starts, 0);
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
