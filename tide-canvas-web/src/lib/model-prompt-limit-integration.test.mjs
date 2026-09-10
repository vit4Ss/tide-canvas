import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const admin = read("../app/admin/models/page.tsx");
const studio = read("../components/studio/create-studio/use-generation.ts");
const studioPage = read("../components/studio/create-studio.tsx");
const canvasVideo = read("../components/canvas/nodes/video-node.tsx");
const chatSend = read("../app/(studio)/chat/_hooks/use-send-message.ts");

test("video prompt limit is configurable and zero is documented as unlimited", () => {
  assert.match(admin, /label="提示词字数限制"/);
  assert.match(admin, /min=\{0\}/);
  assert.match(admin, /0 表示不限制/);
  assert.match(admin, /maxPromptChars: type === "video" \? maxPromptChars : undefined/);
});

test("every interactive video generation surface rejects prompt overflow locally", () => {
  assert.match(studio, /curType === "video"[\s\S]*?modelPromptLimitIssue\(p, selectedStudio\?\.config\)/);
  assert.match(canvasVideo, /modelPromptLimitIssue\(finalPrompt, rawConfig\)/);
  assert.match(chatSend, /selModel\?\.type === "video"[\s\S]*?modelPromptLimitIssue\(v, selModel\.config\)/);
});

test("Studio exposes the configured limit beside its Unicode character counter", () => {
  assert.match(studioPage, /maxChars=\{isVideo \? modelPromptCharLimit\(mCfg\) : 0\}/);
  const promptSection = read("../components/studio/create-studio/prompt-section.tsx");
  assert.match(promptSection, /promptCharacterCount\(prompt\.trim\(\)\)/);
  assert.match(promptSection, /promptOverLimit/);
});
