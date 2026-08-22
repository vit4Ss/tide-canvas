import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./use-gen-models.ts", import.meta.url), "utf8");

test("对话模型目录只保留文本模型", () => {
  assert.match(source, /res\.data\.filter\(\(item\) => item\.type === "text"\)/);
  assert.doesNotMatch(source, /CHAT_MODEL_TYPES/);
});
