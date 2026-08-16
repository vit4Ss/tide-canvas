import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const here = new URL(".", import.meta.url);
const read = (relative) => readFileSync(new URL(relative, here), "utf8");

test("paid Studio submits render an optimistic row before the POST", () => {
  const generation = read("./use-generation.ts");
  const optimistic = generation.indexOf('phase: "submitting"');
  const create = generation.indexOf("aiApi.generateIdempotent", optimistic);

  assert.ok(optimistic >= 0);
  assert.ok(create > optimistic);
  assert.match(generation, /dedupeActivePayload:\s*true/);
  assert.match(generation, /res2\.reusedExisting/);
});

test("the click timestamp is captured before the request and kept after acceptance", () => {
  const generation = read("./use-generation.ts");
  const start = generation.indexOf("const startedAt = Date.now()");
  const optimistic = generation.indexOf('phase: "submitting"', start);
  const create = generation.indexOf("aiApi.generateIdempotent", optimistic);
  const acceptedRun = generation.indexOf("const run: ActiveRun", create);
  const reusedStart = generation.indexOf("startedAt,", acceptedRun);

  assert.ok(start >= 0);
  assert.ok(optimistic > start);
  assert.ok(create > optimistic);
  assert.ok(acceptedRun > create);
  assert.ok(reusedStart > acceptedRun);
});

test("startup recovery fences every paid Studio entry point", () => {
  const generation = read("./use-generation.ts");
  const studio = read("../create-studio.tsx");

  assert.match(generation, /const \[recoveringRuns, setRecoveringRuns\] = useState\(true\)/);
  assert.match(generation, /if \(recoveringRuns\) \{[\s\S]*正在恢复生成任务/);
  assert.match(studio, /disabled=\{[^}]*restoringRun[^}]*recoveringRuns[^}]*submitting[^}]*\}/);
  assert.match(studio, /disabled=\{[^}]*referenceVideoQuote\.loading[^}]*\}/);
});

test("new runs become visible and stale history cannot erase local completion", () => {
  const feed = read("./stage-feed.tsx");
  const studio = read("../create-studio.tsx");
  const css = read("../../../styles/liuguang/studio.css");

  assert.match(feed, /feedRef\.current\.scrollTop = 0/);
  assert.match(css, /\.ws-feed\{[^}]*overflow-anchor:none/);
  assert.match(studio, /mergeInitialStudioHistory\(prev, items\)/);
  assert.doesNotMatch(studio, /if \(!append\) setHist\(\[\]\)/);
});

test("ambiguous creates retry quickly with the retained request id", () => {
  const idempotency = read("../../../lib/ai-generation-idempotency.ts");
  assert.match(idempotency, /controller\.abort\(\), 15_000/);
  assert.match(idempotency, /clientRequestId: pending\.clientRequestId/);
});

test("recovery restores accepted tasks first and retires unusable task pointers", () => {
  const generation = read("./use-generation.ts");
  const acceptedFirst = generation.indexOf("Restore accepted tasks first");
  const lookupRetirement = generation.indexOf(
    "entry.taskId && result && !isAmbiguousAiCreateCode(result.code)",
  );
  const commit = generation.indexOf("commitAcceptedAiGeneration(scope, entry.taskId", lookupRetirement);
  const guardedDelay = generation.indexOf("const stillPending = recoverableAiGenerations", commit);

  assert.ok(acceptedFirst >= 0);
  assert.ok(lookupRetirement > acceptedFirst);
  assert.ok(commit > lookupRetirement);
  assert.ok(guardedDelay > commit);
});

test("busy state includes optimistic creates that are still awaiting acceptance", () => {
  const generation = read("./use-generation.ts");
  assert.match(
    generation,
    /const hasOngoingRuns = \(\) =>[\s\S]*runControlsRef\.current\.size > 0 \|\| pendingCreateIdsRef\.current\.size > 0/,
  );
  assert.doesNotMatch(generation, /if \(foreground\) setBusy\(false\)/);
});
