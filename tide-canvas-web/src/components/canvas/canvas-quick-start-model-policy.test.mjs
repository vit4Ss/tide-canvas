import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const quickStartSource = readFileSync(new URL("./canvas-quick-start.tsx", import.meta.url), "utf8");

test("the project launcher defaults to video and only exposes direct video models", () => {
  assert.match(quickStartSource, /useState<QuickStartMode>\(isLauncher \? "video" : "image"\)/);
  assert.match(quickStartSource, /isLauncher && !canvasLauncherAllowsDirectModel\(model\)/);
  assert.match(quickStartSource, /triggerLabel=\{isLauncher \? "视频模型" : "模型"\}/);
  assert.match(quickStartSource, /暂无可用视频模型/);
});

test("clearing a Skill restores the launcher direct-video invariant", () => {
  assert.match(
    quickStartSource,
    /const clearSelectedSkill = \(\) => \{[\s\S]*?setSelectedSkill\(null\);[\s\S]*?setMode\("video"\);[\s\S]*?setSelectedModelId\(""\);/,
  );
  assert.match(quickStartSource, /onClick=\{clearSelectedSkill\}/);
});

test("direct launch submission fails closed while Skill and consumer paths remain available", () => {
  assert.match(
    quickStartSource,
    /isLauncher && !canvasLauncherAllowsDirectModel\(selectedModel\)[\s\S]*?画布入口请选择视频模型/,
  );
  assert.match(quickStartSource, /setMode\(launchJournal\.mode\)/);
  assert.match(quickStartSource, /kind === "preset" && variant === "launcher"/);
});
