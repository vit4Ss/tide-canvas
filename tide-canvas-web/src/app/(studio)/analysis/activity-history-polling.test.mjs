import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate as flush } from "node:timers/promises";
import { reconcileHistoryRows, startDownloadHistoryPolling } from "./activity-history-polling.ts";

const record = (status = "downloading", id = "download-1") => ({
  id, userId: "user-1", userName: "User", type: "download", status,
  sourceUrl: "https://www.douyin.com/video/12345", createTime: "2026-09-05T10:00:00Z", updateTime: "2026-09-05T10:00:00Z",
});

function clock(t) {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  return async (ms) => { t.mock.timers.tick(ms); await flush(); };
}

test("unchanged refreshes retain the list and avatar rows; only changed records are replaced", () => {
  const current = [record(), { ...record("succeeded", "analysis-2"), avatarUrl: "https://example.com/avatar.png" }];
  assert.equal(reconcileHistoryRows(current, current.map((row) => ({ ...row }))), current);
  const changed = reconcileHistoryRows(current, [{ ...current[0], status: "succeeded", downloadedBytes: 100 }, { ...current[1] }]);
  assert.notEqual(changed, current);
  assert.notEqual(changed[0], current[0]);
  assert.equal(changed[1], current[1]);
  assert.equal(changed[0].status, "succeeded");
  assert.deepEqual(reconcileHistoryRows(current, [current[1]]), [current[1]]);
  assert.deepEqual(reconcileHistoryRows(current, [current[1], current[0]]), [current[1], current[0]]);
  const withoutAvatar = { ...current[1] };
  delete withoutAvatar.avatarUrl;
  assert.notEqual(reconcileHistoryRows(current, [current[0], withoutAvatar])[1], current[1]);
});

test("active downloads poll sequentially and each terminal status stops polling", async (t) => {
  const tick = clock(t);
  for (const status of ["succeeded", "failed", "expired"]) {
    let calls = 0;
    const stop = startDownloadHistoryPolling("download-1", async () => [record(++calls === 1 ? "downloading" : status)], () => false);
    await tick(5_000);
    assert.equal(calls, 1);
    await tick(5_000);
    assert.equal(calls, 2);
    await tick(60_000);
    assert.equal(calls, 2);
    stop();
  }
});

test("background tabs and an existing list request pause network polling", async (t) => {
  const tick = clock(t);
  let paused = true;
  let calls = 0;
  const stop = startDownloadHistoryPolling("download-1", async () => { calls++; return [record()]; }, () => paused);
  t.after(stop);
  await tick(20_000);
  assert.equal(calls, 0);
  paused = false;
  await tick(5_000);
  assert.equal(calls, 1);
});

test("slow requests never overlap and cleanup prevents rescheduling after a late response", async (t) => {
  const tick = clock(t);
  let calls = 0;
  let resolve;
  const stop = startDownloadHistoryPolling("download-1", () => {
    calls++;
    return new Promise((done) => { resolve = done; });
  }, () => false);
  await tick(5_000);
  await tick(30_000);
  assert.equal(calls, 1);
  stop();
  resolve([record()]);
  await flush();
  await tick(60_000);
  assert.equal(calls, 1);
});

test("network failures back off and stop after three attempts without replacing history", async (t) => {
  const tick = clock(t);
  let calls = 0;
  const stop = startDownloadHistoryPolling("download-1", async () => {
    calls++;
    if (calls === 2) throw new Error("temporary failure");
    return null;
  }, () => false);
  t.after(stop);
  await tick(5_000);
  assert.equal(calls, 1);
  await tick(9_999);
  assert.equal(calls, 1);
  await tick(1);
  assert.equal(calls, 2);
  await tick(20_000);
  assert.equal(calls, 3);
  await tick(120_000);
  assert.equal(calls, 3);
});

test("a download request that never creates a record cannot poll indefinitely", async (t) => {
  const tick = clock(t);
  let calls = 0;
  const stop = startDownloadHistoryPolling("download-1", async () => { calls++; return []; }, () => false);
  t.after(stop);
  for (let i = 0; i < 8; i++) await tick(5_000);
  assert.equal(calls, 6);
});

test("superseded responses retry, and an expired ticket does not terminate an active download", async (t) => {
  const tick = clock(t);
  let calls = 0;
  const stop = startDownloadHistoryPolling("download-1", async () => {
    if (++calls === 1) return undefined;
    return [{ ...record(), expiresAt: "1970-01-01T00:00:00Z" }];
  }, () => false);
  t.after(stop);
  for (let i = 0; i < 4; i++) await tick(5_000);
  assert.equal(calls, 4);
  t.mock.timers.setTime(66 * 60_000);
  await tick(5_000);
  assert.equal(calls, 4);
});
