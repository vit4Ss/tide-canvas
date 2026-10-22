import assert from "node:assert/strict";
import test from "node:test";
import { createCanvasModelCatalog, resolveCanvasModelId } from "./canvas-model-catalog.ts";

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const model = (modelId, config = "{}") => ({ modelId, type: "image", config });

test("concurrent nodes share one catalog request and late nodes reuse the mounted catalog", async () => {
  const response = deferred();
  let calls = 0;
  const catalog = createCanvasModelCatalog(() => { calls += 1; return response.promise; });
  const stop = catalog.subscribe(() => {});
  const first = catalog.load();
  assert.equal(catalog.load(), first);
  response.resolve({ success: true, data: [model("primary")] });
  await first;
  assert.equal(calls, 1);
  assert.equal((await catalog.load()).models[0].modelId, "primary");
  assert.equal(calls, 1);
  stop();
});

test("successful empty catalog is ready; API failures preserve the actual message and can retry", async () => {
  let calls = 0;
  const catalog = createCanvasModelCatalog(async () => ++calls === 1
    ? { success: false, message: "网络连接失败，请检查网络后重试" }
    : { success: true, data: [] });
  const stop = catalog.subscribe(() => {});
  assert.deepEqual(await catalog.load(), { status: "error", models: [], error: "网络连接失败，请检查网络后重试" });
  const retry = catalog.reload();
  assert.equal(catalog.getSnapshot().status, "loading");
  assert.equal(catalog.reload(), retry);
  assert.deepEqual(await retry, { status: "ready", models: [], error: null });
  assert.equal(calls, 2);
  stop();
});

test("rejected or malformed responses never masquerade as an empty model catalog", async () => {
  const rejected = createCanvasModelCatalog(async () => { throw new Error("network unreachable"); });
  assert.equal((await rejected.load()).status, "error");
  const malformed = createCanvasModelCatalog(async () => ({ success: true }));
  assert.deepEqual(await malformed.load(), { status: "error", models: [], error: "模型列表响应异常，请重试" });
});

test("the last node leaving releases the catalog and an old request cannot overwrite a new session", async () => {
  const old = deferred();
  let calls = 0;
  const catalog = createCanvasModelCatalog(() => ++calls === 1 ? old.promise : Promise.resolve({ success: true, data: [model("new")] }));
  const stopOld = catalog.subscribe(() => {});
  const oldRequest = catalog.load();
  await Promise.resolve();
  stopOld();
  await Promise.resolve();
  const stopNew = catalog.subscribe(() => {});
  await catalog.load();
  old.resolve({ success: true, data: [model("old")] });
  await oldRequest;
  assert.equal(catalog.getSnapshot().models[0].modelId, "new");
  stopNew();
  await Promise.resolve();
  assert.deepEqual(catalog.getSnapshot(), { status: "loading", models: [], error: null });
});

test("StrictMode immediate remount shares the pending request", async () => {
  const response = deferred();
  const catalog = createCanvasModelCatalog(() => response.promise);
  const stopFirst = catalog.subscribe(() => {});
  const request = catalog.load();
  stopFirst();
  const stopSecond = catalog.subscribe(() => {});
  await Promise.resolve();
  assert.equal(catalog.load(), request);
  response.resolve({ success: true, data: [] });
  await request;
  stopSecond();
});

test("selection preserves user choice, then saved preference, primary, and first model", () => {
  const models = [model("first", "invalid"), model("primary", '{"imagePrimary":true}'), model("saved"), model("chosen")];
  assert.equal(resolveCanvasModelId(models, "chosen", "saved"), "chosen");
  assert.equal(resolveCanvasModelId(models, "missing", "saved"), "saved");
  assert.equal(resolveCanvasModelId(models, "", "missing"), "primary");
  assert.equal(resolveCanvasModelId([models[0]], ""), "first");
  assert.equal(resolveCanvasModelId([], "chosen", "saved"), "");
});
