import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relativeUrl) => readFileSync(new URL(relativeUrl, import.meta.url), "utf8");

const studio = read("../studio/create-studio.tsx");
const studioPrompt = read("../studio/create-studio/prompt-section.tsx");
const chatPage = read("../../app/(studio)/chat/page.tsx");
const chatComposer = read("../../app/(studio)/chat/_components/composer.tsx");
const quickStart = read("../canvas/canvas-quick-start.tsx");
const assistant = read("../canvas/canvas-assistant-panel.tsx");
const chipStyles = read("./skill-prompt-chip.module.css");

test("四个技能入口都把技能标签渲染在输入区域内", () => {
  assert.match(studioPrompt, /<div className="ws-prompt-main">[\s\S]*?<SkillPromptChip[\s\S]*?<MentionPromptEditor/);
  assert.match(chatComposer, /<div className="composer-head">[\s\S]*?<SkillPromptChip[\s\S]*?<MentionPromptEditor/);
  assert.match(quickStart, /className=\{styles\.editorRow\}>[\s\S]*?<SkillPromptChip[\s\S]*?<PromptRefEditor/);
  assert.match(assistant, /className="flex min-w-0 items-start gap-2 pr-8">[\s\S]*?<SkillPromptChip[\s\S]*?<PromptRefEditor/);
});

test("四个入口选择技能时都应用公开起始提示且保留已有草稿", () => {
  assert.match(studio, /setPrompt\(\(current\) => promptAfterSkillPick\(current, s, skill\)\)/);
  assert.match(chatPage, /setDraft\(\(current\) => promptAfterSkillPick\(current, nextSkill, cfg\.skill\)\)/);
  assert.match(quickStart, /promptAfterSkillPick\(current, skill, selectedSkill\)/);
  assert.match(assistant, /setMessage\(\(current\) => promptAfterSkillPick\(current, skill, selectedSkill\)\)/);
});

test("选择入口保留在工具栏，已选状态显示数量而不是重复技能名称", () => {
  assert.match(studioPrompt, /更多技能 · 1/);
  assert.match(chatComposer, /cm-skill-count/);
  assert.match(quickStart, /selectedSkill \? "技能 1" : "技能"/);
  assert.match(assistant, /selectedSkill \? "技能 1" : "技能"/);
});

test("技能标签在暗色画布可读，移除按钮满足最小触控热区", () => {
  assert.match(chipStyles, /:global\(\.dark\) \.root \{[\s\S]*?color: var\(--text, #f5f5f7\);/);
  assert.match(chipStyles, /\.remove \{[\s\S]*?width: 24px;[\s\S]*?height: 24px;/);
});
