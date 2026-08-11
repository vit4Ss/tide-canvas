import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node's native TypeScript loader requires the source suffix.
import { mergeInitialStudioHistory } from "./history-merge.ts";
import type { HistItem } from "./types";

function item(id: string, run: string, ts: string): HistItem {
  return {
    id,
    run,
    ts,
    hues: [1, 2, 3],
    type: "image",
    title: id,
    prompt: id,
    model: "model",
  };
}

test("a locally completed task survives a stale first-page response", () => {
  const local = item("local", "task-new", "2026-08-12T12:00:00.000Z");
  const old = item("old", "task-old", "2026-08-12T11:00:00.000Z");

  assert.deepEqual(
    mergeInitialStudioHistory([local], [old]).map((row) => row.id),
    ["local", "old"],
  );
});

test("server rows replace the same local run without duplicating its cells", () => {
  const local = item("temporary", "task-same", "2026-08-12T12:00:00.000Z");
  const server = item("server", "task-same", "2026-08-12T12:00:00.000Z");

  assert.deepEqual(mergeInitialStudioHistory([local], [server]).map((row) => row.id), ["server"]);
});
