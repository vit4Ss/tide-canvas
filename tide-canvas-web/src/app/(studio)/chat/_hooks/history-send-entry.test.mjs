import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./use-send-message.ts", import.meta.url), "utf8");

test("history target guard executes before state changes, auth, and paid APIs", () => {
  const sendStart = source.indexOf("const send = useCallback(async (expected?: HistorySendTarget) => {");
  const matcher = source.indexOf("historySendTargetMatches(expected", sendStart);
  const mismatchReturn = source.indexOf("if (!targetStillCurrent)", matcher);
  const firstBusyMutation = source.indexOf("setBusy(true)", sendStart);
  const firstSessionCall = source.indexOf("ensureSession()", sendStart);
  const mediaCreate = source.indexOf("aiApi.generate", sendStart);
  const textCreate = source.indexOf("streamMessage(", sendStart);

  assert.ok(sendStart >= 0, "send must accept the immutable history target");
  assert.ok(matcher > sendStart, "send must evaluate the history target");
  assert.ok(mismatchReturn > matcher, "a mismatched target must return early");
  for (const [label, boundary] of [
    ["busy state mutation", firstBusyMutation],
    ["session/auth call", firstSessionCall],
    ["media generation call", mediaCreate],
    ["text generation call", textCreate],
  ]) {
    assert.ok(boundary > mismatchReturn, `${label} must occur after the mismatch return`);
  }
});
