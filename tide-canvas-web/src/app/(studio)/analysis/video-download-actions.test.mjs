import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { shouldKeepSocialRequest } from "./billing-retry.ts";

// Execute the production actions with controlled API/session boundaries.
const source = readFileSync(new URL("./analysis-workbench.tsx", import.meta.url), "utf8");
const actions = source.slice(source.indexOf("  const startVideoFile ="), source.indexOf("  const reEditRun ="));
const code = ts.transpileModule(`${actions}\nglobalThis.resolve = resolveVideoDownload; globalThis.downloadCard = downloadResolvedVideo;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const result = (overrides = {}) => ({ id: "current", quality: "quality", expiresAt: Date.now() / 1000 + 300, ...overrides });

function setup(initial = {}) {
  const requests = [], downloads = [];
  let requestSerial = 0;
  const context = vm.createContext({
    downloadBusyRef: { current: false }, downloadEpochRef: { current: 0 },
    downloadSource: "https://www.douyin.com/video/12345", downloadResult: null,
    downloadedPreviewUrl: "", historicalRecord: null, downloaderCapabilities: {pointCost: 1, dailyRemaining: 1},
    videoDownload: { busy: false, state: {phase:"idle",resultId:""}, start: (file) => downloads.push(file.id) },
    extractDownloadURL: (url) => url, ensureSession: async () => true,
    setWatchedDownloadRecordId() {}, setHistoryRefresh() {}, setDownloaderRefresh() {},
    refreshBalance: async () => {}, ownerUserId: "owner", downloadPointCost: 1, downloadInsufficient: false, pendingDownloadKey: "",
    shouldKeepSocialRequest,
    downloadRequestRef: {current: null}, crypto: {randomUUID: () => ++requestSerial === 1 ? "request-key" : `request-key-${requestSerial}`},
    ...initial,
  });
  context.clearHistoricalView = () => { context.historicalRecord = null; };
  context.setDownloadResult = (value) => { context.downloadResult = value; };
  context.setDownloadBusy = (value) => { context.busy = value; };
  context.setDownloadError = (value) => { context.error = value; };
  context.setPendingDownloadKey = (value) => { context.pendingDownloadKey = value; };
  context.socialAnalysisApi = { resolveDownload: async (request) => {
    requests.push({ ...request });
    return { success: true, data: result({ id: "renewed" }) };
  } };
  vm.runInContext(code, context);
  return { context, requests, downloads };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("missing pricing never starts a new charge, but cached files remain free to save", async () => {
  const missing = setup({downloaderCapabilities: null});
  await missing.context.resolve(true);
  assert.equal(missing.requests.length, 0);
  assert.match(missing.context.error, /积分价格/);
  const cached = setup({downloaderCapabilities: null, downloadResult: result({expiresAt: 1}), downloadedPreviewUrl: "blob:local"});
  await cached.context.resolve(true);
  assert.equal(cached.requests.length, 0);
  assert.equal(cached.downloads.length, 1);
});

test("daily quota blocks new downloads and expired card retries without resolving or charging", async () => {
  for (const card of [false, true]) {
    const { context, requests, downloads } = setup({ downloaderCapabilities: {dailyRemaining: 0}, downloadResult: card ? result({expiresAt: 1}) : null });
    if (card) { context.downloadCard(); await settle(); } else await context.resolve(true);
    assert.equal(requests.length, 0);
    assert.equal(downloads.length, 0);
    assert.match(context.error, /次数已用完/);
  }
});

test("an exhausted daily quota still allows the same pending request and prepaid file", async () => {
  const { context, requests } = setup({downloaderCapabilities: {dailyRemaining: 0}, pendingDownloadKey: "owner:https://www.douyin.com/video/12345"});
  context.downloadRequestRef.current = {key: context.pendingDownloadKey, id: "reserved-request"};
  await context.resolve(true);
  assert.equal(requests[0].clientRequestId, "reserved-request");
  for (const state of [{downloadResult: result()}, {historicalRecord: {download: result()}}, {downloadResult: result({expiresAt: 1}), downloadedPreviewUrl: "blob:saved"}]) {
    const run = setup({...state, downloaderCapabilities: {dailyRemaining: 0}, downloadInsufficient: true});
    await run.context.resolve(true);
    assert.equal(run.requests.length, 0);
    assert.equal(run.downloads.length, 1);
  }
});

test("insufficient points also block keyboard-triggered new downloads", async () => {
  const {context, requests} = setup({downloadInsufficient: true});
  await context.resolve(true);
  assert.equal(requests.length, 0);
  assert.match(context.error, /积分不足/);
});

test("uncertain network retries keep the billing request key and insufficient responses never download", async () => {
  const { context, downloads } = setup();
  const keys = [];
  context.socialAnalysisApi.resolveDownload = async (request) => {
    keys.push(request.clientRequestId);
    return { success: false, code: keys.length === 1 ? 0 : 2001, message: "insufficient" };
  };
  await context.resolve(true);
  assert.ok(context.downloadRequestRef.current);
  await context.resolve(true);
  assert.equal(keys[0], keys[1]);
  assert.equal(context.downloadRequestRef.current, null);
  assert.equal(downloads.length, 0);
});

test("gateway timeouts preserve a single paid download request until a definitive response", async () => {
  for (const code of [200, 408, 425, 499, 502, 503, 504, 599]) {
    const { context, downloads } = setup();
    const keys = [];
    context.socialAnalysisApi.resolveDownload = async request => {
      keys.push(request.clientRequestId);
      return keys.length === 1 ? {success: false, code} : {success: true, data: result()};
    };
    await context.resolve(true);
    assert.equal(context.pendingDownloadKey, `owner:${context.downloadSource}`);
    await context.resolve(true);
    assert.equal(keys[0], keys[1], `request changed after ${code}`);
    assert.equal(context.pendingDownloadKey, "");
    assert.deepEqual(downloads, ["current"]);
  }
});

test("a failed transfer starts a new paid resolve instead of reusing a refunded ticket", async () => {
  const { context, requests, downloads } = setup({ downloadResult: result(), videoDownload: { busy: false, state: { resultId: "current", phase: "failed" }, start: () => {} } });
  await context.resolve(true);
  assert.equal(requests.length, 1);
  assert.equal(downloads.length, 0);
  assert.equal(context.downloadResult.id, "renewed");
});

test("new and legacy-history downloads always request highest quality", async () => {
  for (const quality of [null, "compat", "speed"]) {
    const { context, requests, downloads } = setup({ historicalRecord: quality ? { quality } : null });
    await context.resolve(true);
    assert.deepEqual(requests, [{ url: context.downloadSource, quality: "quality", clientRequestId: "request-key", expectedPointCost: 1 }]);
    assert.deepEqual(downloads, ["renewed"]);
  }
});

test("restored paid reservations continue without another resolve or charge", async () => {
  const reserved = result({ id: "reserved", recordId: "paid-record", pointCost: 1 });
  const { context, requests, downloads } = setup({ historicalRecord: { type: "download", download: reserved } });
  await context.resolve(true);
  assert.equal(requests.length, 0);
  assert.deepEqual(downloads, ["reserved"]);
  assert.equal(context.historicalRecord, null);
});

test("both download buttons reuse received files after the ticket expires", async () => {
  for (const action of ["resolve", "downloadCard"]) {
    const { context, requests, downloads } = setup({ downloadResult: result({ expiresAt: 1 }), downloadedPreviewUrl: "blob:cached" });
    await context[action](true);
    await settle();
    assert.equal(requests.length, 0);
    assert.deepEqual(downloads, ["current"]);
  }
});

test("expired uncached result-card downloads renew the ticket and save the new result", async () => {
  const { context, requests, downloads } = setup({ downloadResult: result({ expiresAt: 1 }) });
  context.downloadCard();
  await settle();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].quality, "quality");
  assert.deepEqual(downloads, ["renewed"]);
});

test("history refresh stays resolve-only and an in-flight request fences double clicks", async () => {
  const refresh = setup({ historicalRecord: { quality: "compat" } });
  await refresh.context.resolve();
  assert.equal(refresh.requests.length, 1);
  assert.equal(refresh.downloads.length, 0);
  const download = setup();
  await Promise.all([download.context.resolve(true), download.context.resolve(true)]);
  assert.equal(download.requests.length, 1);
  assert.deepEqual(download.downloads, ["renewed"]);
});

test("late API responses and failed resolutions never start a stale download", async () => {
  const stale = setup();
  let finish;
  stale.context.socialAnalysisApi.resolveDownload = () => new Promise((resolve) => { finish = resolve; });
  const pending = stale.context.resolve(true);
  await settle();
  stale.context.downloadEpochRef.current += 1;
  stale.context.downloadRequestRef.current = { key: "new-owner", id: "new-owner-request" };
  finish({ success: true, data: result() });
  await pending;
  assert.equal(stale.context.downloadResult, null);
  assert.equal(stale.downloads.length, 0);
  assert.equal(stale.context.downloadRequestRef.current.id, "new-owner-request");

  const failure = setup({ downloadResult: result({ expiresAt: 1 }) });
  failure.context.socialAnalysisApi.resolveDownload = async () => ({ success: false, message: "解析失败" });
  failure.context.downloadCard();
  await settle();
  assert.equal(failure.context.error, "解析失败");
  assert.equal(failure.context.busy, false);
  assert.equal(failure.downloads.length, 0);
});
