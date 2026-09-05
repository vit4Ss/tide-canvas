import assert from "node:assert/strict";
import test from "node:test";
import { parseContentReport } from "./content-report.ts";

test("report extracts existing conclusions and real timestamp ranges from canonical tables", () => {
  const result = parseContentReport(`## 一句话看懂
这是一段通过实际操作解决路由器配置问题的教程。
## 开场钩子
可能通过先展示成果吸引注意，尚不能据此判断留存。
## 值得借鉴
**复用方法不等于照搬：先确定自己的用户问题。**
## 节奏时间线
|开始时间|结束时间|片段|关键发现|
|---|---|---|---|
|00:03|00:15|讲解步骤|用分步操作解释配置方法。|
|00:00|00:03|开场成果|展示配置成功后的实际效果。|
## 完整分析
### 逐字稿
00:00 — 00:03 这里是正文台词，不进入时间线。
`);
  assert.deepEqual(result.takeaways.map(t => t.key), ["summary", "hook", "reuse"]);
  assert.equal(result.takeaways[1].text, "可能通过先展示成果吸引注意，尚不能据此判断留存。");
  assert.equal(result.takeaways[2].text, "复用方法不等于照搬：先确定自己的用户问题。");
  assert.deepEqual(result.moments.map(m => [m.start, m.end, m.title]), [[0, 3, "开场成果"], [3, 15, "讲解步骤"]]);
});

test("legacy headings, inline conclusions and time-range subheadings remain readable", () => {
  const { takeaways, moments } = parseContentReport(`**一句话看懂：**这是一段面向新手的入门教程。
## 开头 3 秒钩子
### 事实
开场展示操作结果，让观众知道接下来能学到什么。
## 可复用方法
复用方法需要结合你的目标用户
## 叙事结构
### 00:00–00:03 展示成果
画面首先展示网络配置结果。
### 00:03–00:10 拆解步骤
按顺序讲解操作流程。
## 转写
00:10 — 00:15 这段台词不应作为镜头时间线。
`);
  assert.equal(takeaways.length, 3);
  assert.equal(takeaways[2].text, "复用方法需要结合你的目标用户");
  assert.deepEqual(moments.map(m => [m.start, m.end]), [[0, 3], [3, 10]]);
});

test("invalid, reversed, duplicate and ungrounded intervals never produce timeline items", () => {
  const { moments } = parseContentReport(`## 节奏时间线
|00:61|00:70|错误|秒数不正确|
|01:00|00:30|错误|倒序区间|
|00:00|00:00|错误|空区间|
|999:00:00|999:01:00|错误|超出范围|
|01:66:00|01:67:00|错误|分钟不正确|
|1000:00|1001:00|错误|超长时间|
|00:01|00:04|有效|可以展示的片段|
|00:01|00:04|重复|重复片段|
00:09 只有单个时间，不能推算结束时间。
|00:10|00:12|来源|https://example.com|

~~~text
|00:20|00:30|代码|不是报告正文|
~~~
`);
  assert.deepEqual(moments.map(m => [m.start, m.end]), [[1, 4]]);
});

test("HH:MM:SS and fractional clocks are preserved, with at most eight ordered moments", () => {
  const rows = Array.from({ length: 12 }, (_, i) => `|01:00:${String(i).padStart(2, "0")}.5|01:00:${String(i + 1).padStart(2, "0")}.5|片段 ${i}|发现 ${i}|`).reverse();
  const result = parseContentReport(`## 节奏时间线\n${rows.join("\n")}`);
  assert.equal(result.moments.length, 8);
  assert.equal(result.moments[0].start, 3600.5);
  assert.equal(result.moments.at(-1).end, 3608.5);
});

test("empty and unstructured old reports do not invent conclusions or scores", () => {
  for (const input of ["", "这个视频需要展开查看完整分析。", "00:00–00:30 无结构的文字"]) {
    assert.deepEqual(parseContentReport(input), { takeaways: [], moments: [] });
  }
  assert.deepEqual(parseContentReport("## 一句话看懂\n" + "很".repeat(201)), { takeaways: [], moments: [] });
});

test("image reports use visual conclusions and never receive a video timeline", () => {
  const result = parseContentReport("## 视觉焦点\n可能通过主体与背景的明暗差建立视觉层次。\n## 叙事结构\n|00:00|00:03|开场|这里不是视频|");
  assert.equal(result.moments.length, 1);
  const image = parseContentReport("## 视觉焦点\n可能通过主体与背景的明暗差建立视觉层次。\n## 叙事结构\n|00:00|00:03|开场|这里不是视频|", true);
  assert.equal(image.takeaways[0].label, "视觉焦点");
  assert.deepEqual(image.moments, []);
});

test("compact conclusions preserve qualifications across sentences and soft line breaks", () => {
  const { takeaways } = parseContentReport(`## 开场钩子
开场展示成品，可能让用户更快理解主题。
但没有留存数据，不能确认这种开场更有效。

后面的其他建议不应混入这条结论。
## 值得借鉴
可以参考这种叙事方式。但不建议直接复制人物和台词。
`);
  assert.equal(takeaways[0].text, "开场展示成品，可能让用户更快理解主题。 但没有留存数据，不能确认这种开场更有效。");
  assert.equal(takeaways[1].text, "可以参考这种叙事方式。但不建议直接复制人物和台词。");
});

test("two separate mentions of timestamps are not a continuous timeline interval", () => {
  const { moments } = parseContentReport(`## 叙事结构
在 00:03 提出疑问，到 00:20 才揭晓结果，形成前后呼应。
00:03 的画面与 00:20 的画面相互呼应。
-00:03 — 00:10 不正确的负数时间。
|00:10|00:15|实际片段|展示了具体的操作流程。|
`);
  assert.deepEqual(moments.map(m => [m.start, m.end]), [[10, 15]]);
});

test("legacy time-range headings retain their title and associated discovery", () => {
  const { moments } = parseContentReport(`## 镜头节奏
### 00:00 — 00:03 开场成果
画面先展示搭建完成后的运行效果。
### 00:03 — 00:15 操作步骤
逐步展示安装设置，降低理解难度。
`);
  assert.deepEqual(moments.map(m => [m.title, m.text]), [
    ["开场成果", "画面先展示搭建完成后的运行效果。"],
    ["操作步骤", "逐步展示安装设置，降低理解难度。"],
  ]);
});

test("transcripts under a report title never become a summary", () => {
  const result = parseContentReport("# 视频概述\n## 完整转写\n这句话是视频中的台词，不是这部视频的摘要。");
  assert.deepEqual(result.takeaways, []);
});

test("uncertainty stated in legacy subheadings follows the extracted conclusion", () => {
  const { takeaways } = parseContentReport(`## 开场钩子
### 推断
开头的问题设置有助于观众继续观看。
## 值得借鉴
### 待验证假设
先展示结果再讲过程能够提高内容吸引力。
`);
  assert.equal(takeaways[0].text, "推断：开头的问题设置有助于观众继续观看。");
  assert.equal(takeaways[1].text, "待验证：先展示结果再讲过程能够提高内容吸引力。");
  assert.deepEqual(parseContentReport("## 值得借鉴\n### 推断\n|维度|说明|\n|---|---|\n|样本|仅供比较|\n").takeaways, []);
});
