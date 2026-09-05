import assert from "node:assert/strict";
import test from "node:test";
import { extractAccountReportBrief } from "./account-report-brief.ts";

test("short report headings yield three existing sentences, not the detailed appendix", () => {
  const brief = extractAccountReportBrief("## 一句话定位\n面向家庭网络用户的实用教程账号。\n## 值得借鉴\n标题把具体问题与操作结果放在一起。\n## 下一步建议\n先测试一个系列化的家庭网络排障选题。\n## 详细分析\n长篇依据不应出现在速览里。");
  assert.deepEqual(brief.map(item => item.key), ["position", "strength", "action"]);
  assert.equal(brief[2].text, "先测试一个系列化的家庭网络排障选题。");
  assert.ok(brief.every(item => !item.text.includes("长篇")));
});

test("legacy sections retain inference and negation instead of repeating numeric facts", () => {
  const report = "## 账号定位\n**事实：**\n账号有 2926 粉丝，12 条近期作品。\n**推断：**\n该账号可能面向家庭用户，并不是硬件测评账号。\n## 内容支柱\n### 1. 实用教程\n主要围绕家庭网络与工具软件，尚不能判断哪类观众占比最高。\n## 下一轮内容建议\n建议先测试操作演示类标题，不应直接承诺播放增长。";
  const brief = extractAccountReportBrief(report);
  assert.equal(brief[0].text, "该账号可能面向家庭用户，并不是硬件测评账号。");
  assert.equal(brief[1].text, "主要围绕家庭网络与工具软件，尚不能判断哪类观众占比最高。");
  assert.match(brief[2].text, /不应直接承诺/);
});

test("inline labels are supported without treating tables or code as conclusions", () => {
  const brief = extractAccountReportBrief("**账号定位：** 面向普通用户的教程账号。\n## 内容建议\n|选题|操作|\n|---|---|\n|随机表格|不应作为一句话总结|\n```json\n## 下一步建议\n假的代码块结论。\n```\n## 可复用方法\n可以复用问题与解决方案的标题组合。");
  assert.deepEqual(brief.map(item => item.key), ["position", "strength"]);
  assert.equal(brief[0].text, "面向普通用户的教程账号。");
});

test("unstructured, empty and oversized passages fall back to the full report without fabricating summaries", () => {
  for (const text of ["", "只有不带标题的旧正文。", "## 下一步建议\n" + "很长的解释".repeat(100)]) assert.deepEqual(extractAccountReportBrief(text), []);
});

test("a short recommendation mentioning its heading remains a sentence", () => {
  const brief = extractAccountReportBrief("下一步建议：\n下一步建议先尝试家庭网络选题。\n## 账号定位\n账号定位可能是软件教程方向。");
  assert.equal(brief.find(item => item.key === "action").text, "下一步建议先尝试家庭网络选题。");
  assert.equal(brief.find(item => item.key === "position").text, "账号定位可能是软件教程方向。");
});

test("bold conclusions remain report content rather than becoming empty sections", () => {
  const brief = extractAccountReportBrief("## 一句话定位\n**可能面向普通用户的实用教程账号，并非硬件测评。**\n## 值得借鉴\n**用具体问题组织教程内容，方便用户理解。**\n## 下一步建议\n**先测试一个排障系列，不要承诺播放增长。**");
  assert.deepEqual(brief.map(item => item.key), ["position", "strength", "action"]);
  assert.equal(brief[0].text, "可能面向普通用户的实用教程账号，并非硬件测评。");
});

test("a colon inside a recommendation does not remove the start of the sentence", () => {
  const brief = extractAccountReportBrief("## 下一步建议\n下一步不建议直接扩大选题：先验证已有系列的反馈。");
  assert.equal(brief[0].text, "下一步不建议直接扩大选题：先验证已有系列的反馈。");
});

test("legacy numbered bold subsections do not become the takeaway", () => {
  const brief = extractAccountReportBrief("## 内容支柱\n**1. 路由器/OpenWrt/家庭网络实操**\n围绕家庭网络的实际问题组织内容，仍需验证观众需求。\n## 下一步建议\n**先验证已有系列的反馈**");
  assert.equal(brief[0].text, "围绕家庭网络的实际问题组织内容，仍需验证观众需求。");
  assert.equal(brief[1].text, "先验证已有系列的反馈");
});
