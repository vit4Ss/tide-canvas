import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  orderStudioFeedRuns,
  upsertInflightRunNewestFirst,
} from "./inflight-run-order.ts";

const run = (taskId, startedAt, progress = 6) => ({
  taskId,
  startedAt,
  meta: {},
  cells: [],
  progs: [progress],
});
const here = new URL(".", import.meta.url);
const read = (relative) => readFileSync(new URL(relative, here), "utf8");

test("a newly started task is inserted above an existing in-flight task", () => {
  const ordered = upsertInflightRunNewestFirst(
    [run("older", 1_000)],
    run("newer", 2_000),
  );

  assert.deepEqual(ordered.map((item) => item.taskId), ["newer", "older"]);
});

test("recovering an older task later does not move it above the newer task", () => {
  const ordered = upsertInflightRunNewestFirst(
    [run("newer", 2_000)],
    run("older", 1_000),
  );

  assert.deepEqual(ordered.map((item) => item.taskId), ["newer", "older"]);
});

test("upserting progress keeps one row for the task and preserves time order", () => {
  const ordered = upsertInflightRunNewestFirst(
    [run("newer", 2_000), run("older", 1_000)],
    run("older", 1_000, 42),
  );

  assert.deepEqual(ordered.map((item) => item.taskId), ["newer", "older"]);
  assert.deepEqual(ordered.find((item) => item.taskId === "older")?.progs, [42]);
});

test("a newer completed task stays above an older task that is still generating", () => {
  const ordered = orderStudioFeedRuns(
    [run("older-live", 1_000)],
    [{ run: "newer-done", ts: new Date(2_000).toISOString(), items: [] }],
  );

  assert.deepEqual(ordered.map((item) => item.key), [
    "finished-newer-done",
    "inflight-older-live",
  ]);
});

test("an older task completing later cannot jump above a newer task", () => {
  const ordered = orderStudioFeedRuns(
    [],
    [
      { run: "older", ts: new Date(1_000).toISOString(), items: [] },
      { run: "newer", ts: new Date(2_000).toISOString(), items: [] },
    ],
  );

  assert.deepEqual(ordered.map((item) => item.key), [
    "finished-newer",
    "finished-older",
  ]);
});

test("invalid legacy timestamps remain below valid current tasks", () => {
  const ordered = orderStudioFeedRuns(
    [run("current", 2_000)],
    [{ run: "legacy", ts: "", items: [] }],
  );

  assert.deepEqual(ordered.map((item) => item.key), [
    "inflight-current",
    "finished-legacy",
  ]);
});

test("a recovered live task hides its already-fetched history duplicate", () => {
  const ordered = orderStudioFeedRuns(
    [run("same-task", 2_000)],
    [{ run: "task-same-task", ts: new Date(2_000).toISOString(), items: [] }],
  );

  assert.deepEqual(ordered.map((item) => item.key), ["inflight-same-task"]);
});

test("StageFeed renders the unified order and completion records the start time", () => {
  const stageFeed = read("./stage-feed.tsx");
  const generation = read("./use-generation.ts");

  assert.match(stageFeed, /orderStudioFeedRuns\(inflightRuns, runs\)/);
  assert.match(stageFeed, /orderedFeedRuns\.map\(\(entry\) =>/);
  assert.doesNotMatch(stageFeed, /inflightRuns\.map\(\(inflight\) =>/);
  assert.doesNotMatch(stageFeed, /runs\.map\(\(r\) =>/);
  assert.match(generation, /const ts = new Date\(startedAt\)\.toISOString\(\)/);
});
