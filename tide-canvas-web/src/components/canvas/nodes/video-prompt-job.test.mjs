import assert from "node:assert/strict";
import test from "node:test";
import { createVideoPromptJobRegistry, canApplyVideoPromptResult } from "./video-prompt-job.ts";

test("deselecting and reselecting keeps the same paid job locked", () => {
  const jobs = createVideoPromptJobRegistry();
  const unsubscribe = jobs.subscribe(() => {});
  const first = jobs.begin("project", "video", "original");
  unsubscribe();
  assert.equal(jobs.get("project", "video"), first);
  assert.equal(jobs.begin("project", "video", "original"), null);
  let completionNotices = 0;
  jobs.subscribe(() => { completionNotices++; });
  jobs.finish(first);
  assert.equal(completionNotices, 1);
  assert.equal(jobs.get("project", "video"), null);
});

test("jobs are isolated by project and stale completion cannot release a newer job", () => {
  const jobs = createVideoPromptJobRegistry();
  const old = jobs.begin("a", "node", "one");
  const other = jobs.begin("b", "node", "two");
  jobs.finish(old);
  const next = jobs.begin("a", "node", "new");
  jobs.finish(old);
  assert.equal(jobs.get("a", "node"), next);
  assert.equal(jobs.get("b", "node"), other);
});

test("stale paid results remain available to copy after completion and remount", () => {
  const jobs = createVideoPromptJobRegistry();
  const job = jobs.begin("project", "node", "original");
  jobs.save(job, "paid result");
  jobs.finish(job);
  assert.equal(jobs.get("project", "node").state, "saved");
  assert.equal(jobs.get("project", "node").result, "paid result");
  assert.ok(jobs.begin("project", "node", "edited"));
});

test("unchanged unmounted nodes can receive results but edits and project changes cannot", () => {
  const jobs = createVideoPromptJobRegistry();
  const job = jobs.begin("project", "node", "original");
  const node = { id: "node", prompt: "original", status: "idle" };
  assert.equal(canApplyVideoPromptResult(job, "project", node), true);
  assert.equal(canApplyVideoPromptResult(job, "other", node), false);
  assert.equal(canApplyVideoPromptResult(job, "project", undefined), false);
  for (const change of [{ id: "other" }, { prompt: "edited" }, { status: "generating" }, { uploading: true }, { pendingGeneration: {} }]) {
    assert.equal(canApplyVideoPromptResult(job, "project", { ...node, ...change }), false);
  }
});
