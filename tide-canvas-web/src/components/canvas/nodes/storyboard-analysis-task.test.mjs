import assert from "node:assert/strict";
import test from "node:test";
import {
  awaitStoryboardAnalysisTask,
  cleanupStoryboardFrameTasks,
} from "./storyboard-analysis-task.ts";

test("a task created after cancellation is deleted without being claimed", async () => {
  const cancelled = [];
  const claimed = [];
  const result = await awaitStoryboardAnalysisTask({
    taskId: "late-task",
    active: () => false,
    getTask: async () => ({ status: 1 }),
    cancelTask: async (id) => { cancelled.push(id); },
    onClaim: (id) => claimed.push(id),
    onRelease: () => assert.fail("an unclaimed task must not be released"),
  });

  assert.equal(result, null);
  assert.deepEqual(cancelled, ["late-task"]);
  assert.deepEqual(claimed, []);
});

test("timeout cancels and releases exactly the task owned by that run", async () => {
  const cancelled = [];
  const released = [];
  let clock = 0;

  await assert.rejects(
    awaitStoryboardAnalysisTask({
      taskId: "owned-task",
      active: () => true,
      getTask: async () => ({ status: 0 }),
      cancelTask: async (id) => { cancelled.push(id); },
      onClaim: () => undefined,
      onRelease: (id) => released.push(id),
      timeoutMs: 10,
      now: () => clock,
      wait: async () => { clock += 10; },
    }),
    /任务已停止/,
  );

  assert.deepEqual(cancelled, ["owned-task"]);
  assert.deepEqual(released, ["owned-task"]);
});

test("aborted frame cleanup deduplicates captured task ids", async () => {
  const cancelled = [];
  await cleanupStoryboardFrameTasks(["frame-1", "frame-1", "frame-2"], async (id) => {
    cancelled.push(id);
  });
  assert.deepEqual(cancelled.sort(), ["frame-1", "frame-2"]);
});
