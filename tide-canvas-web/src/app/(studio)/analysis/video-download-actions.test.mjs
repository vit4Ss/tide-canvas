import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

// Execute the production actions with controlled API/session boundaries.
const source = readFileSync(new URL("./analysis-workbench.tsx", import.meta.url), "utf8");
const actions = source.slice(source.indexOf("  const startVideoFile ="), source.indexOf("  const reEditRun ="));
const code = ts.transpileModule(`${actions}\nglobalThis.resolve = resolveVideoDownload; globalThis.downloadCard = downloadResolvedVideo;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const result = (overrides = {}) => ({ id: "current", quality: "quality", expiresAt: Date.now() / 1000 + 300, ...overrides });

function setup(initial = {}) {
  const requests = [], downloads = [];
  const context = vm.createContext({
    downloadBusyRef: { current: false }, downloadEpochRef: { current: 0 },
    downloadSource: "https://www.douyin.com/video/12345", downloadResult: null,
    downloadedPreviewUrl: "", historicalRecord: null, downloaderCapabilities: null,
    videoDownload: { busy: false, start: (file) => downloads.push(file.id) },
    extractDownloadURL: (url) => url, ensureSession: async () => true,
    setWatchedDownloadRecordId() {}, setHistoryRefresh() {},
    ...initial,
  });
  context.clearHistoricalView = () => { context.historicalRecord = null; };
  context.setDownloadResult = (value) => { context.downloadResult = value; };
  context.setDownloadBusy = (value) => { context.busy = value; };
  context.setDownloadError = (value) => { context.error = value; };
  context.socialAnalysisApi = { resolveDownload: async (request) => {
    requests.push({ ...request });
    return { success: true, data: result({ id: "renewed" }) };
  } };
  vm.runInContext(code, context);
  return { context, requests, downloads };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("new and legacy-history downloads always request highest quality", async () => {
  for (const quality of [null, "compat", "speed"]) {
    const { context, requests, downloads } = setup({ historicalRecord: quality ? { quality } : null });
    await context.resolve(true);
    assert.deepEqual(requests, [{ url: context.downloadSource, quality: "quality" }]);
    assert.deepEqual(downloads, ["renewed"]);
  }
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
  finish({ success: true, data: result() });
  await pending;
  assert.equal(stale.context.downloadResult, null);
  assert.equal(stale.downloads.length, 0);

  const failure = setup({ downloadResult: result({ expiresAt: 1 }) });
  failure.context.socialAnalysisApi.resolveDownload = async () => ({ success: false, message: "解析失败" });
  failure.context.downloadCard();
  await settle();
  assert.equal(failure.context.error, "解析失败");
  assert.equal(failure.context.busy, false);
  assert.equal(failure.downloads.length, 0);
});
