import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const generation = readFileSync(new URL("./use-generation.ts", import.meta.url), "utf8");

test("Studio image-input modes require an uploaded image before prompt validation", () => {
  const guard = generation.indexOf("const referenceIssue = studioReferenceIssue");
  const promptValidation = generation.indexOf("if (!musicTask && !p && !audLyrics && !inputOnly3D)");
  const paidSubmission = generation.indexOf("submissionGate.tryAcquire()", guard);

  assert.ok(guard >= 0, "image-input modes must have an explicit reference guard");
  assert.ok(promptValidation > guard, "the missing-image message must take priority over the prompt message");
  assert.ok(paidSubmission > promptValidation, "image validation must run before a paid task can be created");
  assert.match(generation.slice(guard, promptValidation), /referenceIssue\.severity === "error"/);
  assert.match(generation.slice(guard, promptValidation), /referenceIssue\.markRequired/);
});
