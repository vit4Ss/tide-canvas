import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_MODEL_PROMPT_CHARS,
  modelPromptCharLimit,
  modelPromptLimitIssue,
  promptCharacterCount,
} from "./model-prompt-limit.ts";

test("prompt character count matches Go rune counting instead of UTF-16 length", () => {
  assert.equal(promptCharacterCount("中文A🙂"), 4);
});

test("zero, missing and malformed model limits stay unlimited", () => {
  assert.equal(modelPromptCharLimit(undefined), 0);
  assert.equal(modelPromptCharLimit({ maxPromptChars: 0 }), 0);
  assert.equal(modelPromptCharLimit({ maxPromptChars: -1 }), 0);
  assert.equal(modelPromptCharLimit({ maxPromptChars: 1.5 }), 0);
  assert.equal(modelPromptCharLimit({ maxPromptChars: Number.NaN }), 0);
  assert.equal(modelPromptCharLimit({ maxPromptChars: "100" }), 0);
});

test("configured prompt limit accepts the boundary and rejects only overflow", () => {
  const config = { maxPromptChars: 4 };
  assert.equal(modelPromptLimitIssue("中文A🙂", config), null);
  const issue = modelPromptLimitIssue("中文A🙂B", config);
  assert.equal(issue?.count, 5);
  assert.equal(issue?.limit, 4);
  assert.match(issue?.message ?? "", /当前 5 字/);
  assert.match(issue?.message ?? "", /4 字限制/);
});

test("runtime clamps corrupt oversized values to the admin ceiling", () => {
  assert.equal(modelPromptCharLimit({ maxPromptChars: MAX_MODEL_PROMPT_CHARS + 1 }), MAX_MODEL_PROMPT_CHARS);
});
