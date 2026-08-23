import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const hub = readFileSync(new URL("./tools-hub.tsx", import.meta.url), "utf8");

test("工具中心只展示独立处理工具，不加载或渲染技能工具", () => {
  assert.match(hub, /aiApi\.tools\(\)/);
  assert.match(hub, /id="tools-directory-title">选择处理方式/);
  assert.doesNotMatch(hub, /skillApi|ToolSkillWorkspace|skill-tools-title|创作与分析/);
});
