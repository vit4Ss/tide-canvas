import assert from "node:assert/strict";
import test from "node:test";
import { promptAfterSkillPick, visibleSkillPrompt } from "./skill-prompt.ts";

const skill = (overrides = {}) => ({
  id: "skill-1",
  title: "AI 套话清洗",
  description: "清除机械套话，让文字更自然",
  coverUrl: "",
  category: "文本",
  outputType: "text",
  authorName: "官方",
  status: 1,
  sortOrder: 0,
  useCount: 0,
  createTime: "",
  updateTime: "",
  ...overrides,
});

test("公开起始提示优先使用 howTo，不把目录介绍冒充用户任务", () => {
  assert.equal(
    visibleSkillPrompt(skill({ howTo: "粘贴需要清洗的正文", usageScenario: "公众号文章" })),
    "粘贴需要清洗的正文",
  );
  assert.equal(
    visibleSkillPrompt(skill({ howTo: "", usageScenario: "公众号文章" })),
    "请描述需要完成的任务：【在这里补充目标、素材和要求】",
  );
});

test("缺少 howTo 的旧媒体预设会得到与输出类型匹配的可编辑骨架", () => {
  assert.equal(
    visibleSkillPrompt(skill({ outputType: "image", howTo: "" })),
    "请描述想生成的画面内容：【主体、场景和关键细节】",
  );
  assert.equal(
    visibleSkillPrompt(skill({ outputType: "audio", howTo: "" })),
    "请描述想生成的声音内容：【主题、情绪和声音要求】",
  );
});

test("工具技能会带入与用途匹配的可编辑任务描述", () => {
  assert.equal(
    visibleSkillPrompt(skill({ kind: "tool", title: "生成 PPT", outputType: "file", howTo: "" })),
    "制作一份关于【主题】的商业级 PPT，面向【目标受众】，希望受众最终【理解、相信或决定什么】，约 10 页。请结合我上传的参考图和资料，提炼具体内容、构图与配色。",
  );
  assert.equal(
    visibleSkillPrompt(skill({ kind: "tool", title: "网页分析", outputType: "text", howTo: "" })),
    "分析这个网页：【粘贴公开网页地址】，围绕【具体问题】整理页面主张、证据、含义、风险和缺失信息。",
  );
});

test("空输入框会带入技能引导，已有草稿不会被覆盖", () => {
  const next = skill({ howTo: "帮我清洗这篇文章：【粘贴正文】" });
  assert.equal(promptAfterSkillPick("", next), next.howTo);
  assert.equal(promptAfterSkillPick("保留我的原始需求", next), "保留我的原始需求");
});

test("切换技能时只替换未编辑的旧引导", () => {
  const previous = skill({ id: "old", howTo: "旧技能引导" });
  const next = skill({ id: "new", howTo: "新技能引导" });
  assert.equal(promptAfterSkillPick("旧技能引导", next, previous), "新技能引导");
  assert.equal(promptAfterSkillPick("旧技能引导 + 用户补充", next, previous), "旧技能引导 + 用户补充");
});

test("带入前统一 Windows 换行并清理目录文案两端空白", () => {
  const next = skill({ howTo: "  第一行\r\n第二行  " });
  assert.equal(promptAfterSkillPick("", next), "第一行\n第二行");
});
