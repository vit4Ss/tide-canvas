import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createSubmissionGate } from "./submission-gate.ts";

const here = new URL(".", import.meta.url);
const read = (relative) => readFileSync(new URL(relative, here), "utf8");

test("generation submission gate rejects rapid duplicate clicks synchronously", () => {
  const gate = createSubmissionGate(1_200);

  assert.equal(gate.tryAcquire(10_000), true);
  assert.equal(gate.tryAcquire(10_000), false);
  assert.equal(gate.tryAcquire(10_300), false);
  assert.equal(gate.releaseDelay(10_300), 900);
});

test("generation submission gate can reopen after request settlement and hold window", () => {
  const gate = createSubmissionGate(1_200);

  assert.equal(gate.tryAcquire(5_000), true);
  assert.equal(gate.releaseDelay(6_500), 0);
  assert.equal(gate.tryAcquire(6_500), false, "elapsed time alone must not unlock an unsettled request");
  gate.unlock();
  assert.equal(gate.isLocked(), false);
  assert.equal(gate.tryAcquire(6_500), true);
});

test("Studio paid submits acquire the gate before create and expose locked button state", () => {
  const generation = read("./use-generation.ts");
  const studio = read("../create-studio.tsx");
  const threeD = read("../three-d-studio.tsx");

  const acquire = generation.indexOf("submissionGate.tryAcquire()");
  const create = generation.indexOf("void startGeneration({", acquire);
  const release = generation.indexOf("}).finally(releaseSubmissionGate)", create);

  assert.ok(acquire >= 0, "the synchronous gate must guard Studio submissions");
  assert.ok(create > acquire, "the paid create must happen after gate acquisition");
  assert.ok(release > create, "the gate must release only after task creation settles");
  assert.match(studio, /disabled=\{restoringRun \|\| submitting\}/);
  assert.match(threeD, /disabled=\{submitting\}/);
});
