import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relativeUrl) => readFileSync(new URL(relativeUrl, import.meta.url), "utf8");

const studio = read("../studio/create-studio.tsx");
const studioPrompt = read("../studio/create-studio/prompt-section.tsx");
const studioToolShortcuts = read("../studio/create-studio/tool-skill-shortcuts.tsx");
const studioStyles = read("../../styles/liuguang/studio.css");
const skillPicker = read("./skill-picker.tsx");
const skillCover = read("./skill-cover.ts");
const chatPage = read("../../app/(studio)/chat/page.tsx");
const chatComposer = read("../../app/(studio)/chat/_components/composer.tsx");
const chatConfig = read("../../app/(studio)/chat/_hooks/use-composer-config.ts");
const chatSend = read("../../app/(studio)/chat/_hooks/use-send-message.ts");
const chatApi = read("../../lib/chat-api.ts");
const chatBubble = read("../../app/(studio)/chat/_components/message-bubble.tsx");
const runPanel = read("./skill-run-panel.tsx");
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
  assert.match(chatPage, /setDraft\(\(current\) => promptAfterSkillPick\(current, nextSkill, toolSkill \?\? cfg\.skill\)\)/);
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

test("生成面板在提示词框下方展示技能工具并复用既有运行工作台", () => {
  assert.match(studioPrompt, /<ToolSkillShortcuts[\s\S]*?skills=\{toolSkills\}[\s\S]*?onPick=\{onPickTool\}/);
  assert.match(studio, /skillApi\.list\(\{ kind: "tool", entryPoint: "studio", pageNum: 1, pageSize: 100 \}\)/);
  assert.match(studio, /onPickTool=\{pickSkill\}/);
  assert.match(studio, /skills=\{studioToolSkills \?\? \(toolSkill \? \[toolSkill\] : \[\]\)\}/);
  assert.match(studioToolShortcuts, /onClick=\{\(\) => onPick\(tool\)\}/);
  assert.match(studioToolShortcuts, /为你推荐/);
  assert.match(studioToolShortcuts, /更多技能/);
  assert.match(studioStyles, /\.ws-tool-shortcuts-row\{[^}]*display:flex;[^}]*flex-wrap:wrap/);
  assert.match(studioStyles, /\.ws-tool-shortcuts-label\{[^}]*border-radius:var\(--pill\)/);
});

test("对话输入框下方的技能工具直接附着输入框并从当前会话发送", () => {
  assert.match(chatComposer, /<div className="chat-tool-shortcuts">[\s\S]*?<ToolSkillShortcuts/);
  assert.match(chatComposer, /skill=\{activeSkill\}[\s\S]*?onRemove=\{toolSkill \? onRemoveTool : removeSkill\}/);
  assert.match(chatComposer, /currentId=\{toolSkill\?\.id\}/);
  assert.match(chatPage, /skillApi\.list\(\{ kind: "tool", entryPoint: "studio", pageNum: 1, pageSize: 100 \}\)/);
  assert.match(chatPage, /onPickTool=\{\(nextSkill\) => \{[\s\S]*?setToolSkill\(nextSkill\)[\s\S]*?taRef\.current\?\.focus/);
  assert.doesNotMatch(chatPage, /ToolSkillWorkspace/);
  assert.match(chatPage, /open=\{toolPickerOpen\}[\s\S]*?kinds=\{\["tool"\]\}[\s\S]*?entryPoint="studio"/);
  assert.match(chatPage, /promptAfterSkillPick\(current, nextSkill, cfg\.skill \?\? toolSkill\)/);
  assert.match(chatSend, /skillRunApi\.createIdempotent\(\{[\s\S]*?entryPoint: "studio"[\s\S]*?conversationId: id/);
  assert.match(chatSend, /message\.skillRunId === started\.data!\.id/);
  assert.match(chatConfig, /toolSkill[\s\S]*?"x-asset-types"[\s\S]*?accept: acceptFor\(kinds\)/);
});

test("内置技能工具在后台未配置封面时使用项目位图", () => {
  assert.match(skillPicker, /const coverUrl = skillCoverUrl\(s\)/);
  assert.match(skillPicker, /<img src=\{coverUrl\}/);
  for (const name of ["tool-pptx.webp", "tool-xlsx.webp", "tool-docx.webp", "tool-markdown.webp", "tool-video-analysis.webp", "tool-audio-analysis.webp", "tool-web-analysis.webp"]) {
    assert.match(skillCover, new RegExp(name.replace(".", "\\.")));
  }
  assert.match(skillCover, /if \(configured\) return configured/);
});

test("办公技能保留参考文件与联网并把两者传入执行链路", () => {
  assert.match(chatComposer, /\{webSearchAvail && \(/);
  assert.match(chatConfig, /kinds: \["image", "file"\]/);
  assert.match(chatConfig, /max: Math\.min\(cfgMax, 8\)/);
  assert.match(chatConfig, /Math\.min\(mCfg\.maxFileSizeMB[\s\S]*?: 15, 15\)/);
  assert.match(chatConfig, /image\/\*,\.pdf,\.doc,\.docx,\.xls,\.xlsx,\.csv,\.txt,\.md/);
  assert.match(chatSend, /\(\["image", "file"\] as RefItem\["kind"\]\[\]\)/);
  assert.match(chatSend, /if \(webSearch\) parameters\.webSearch = true/);
  assert.match(chatSend, /parameters\.textModelId = textModelId/);
  assert.match(chatSend, /ref\.id \? \{ id: ref\.id \}/);
  assert.match(chatSend, /selModel\?\.modelKey \|\| selModel\?\.id/);
  assert.match(chatSend, /webSearch: payload\.webSearch/);
  assert.match(chatApi, /\{ webSearch: true \}/);
});

test("聊天技能结果隐藏中间 JSON 并突出最终可下载文件", () => {
  assert.match(chatBubble, /function presentableSkillRun/);
  assert.match(chatBubble, /artifact\.role !== "intermediate"/);
  assert.match(chatBubble, /run=\{presentableSkillRun\(run\)\}/);
  assert.match(chatBubble, /artifact\.type === "file" \? "下载"/);
  assert.match(chatBubble, /finalFiles\.length > 0/);
  assert.match(chatBubble, /className="chat-skill-files"/);
  assert.match(runPanel, /<FileDown aria-hidden/);
  assert.match(runPanel, /terminal \? STATUS_LABEL\[run\.status\]/);
});
