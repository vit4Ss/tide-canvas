import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const button = readFileSync(new URL("./_components/skill-copy-ai-button.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../../../styles/liuguang/admin.css", import.meta.url), "utf8");

test("AI skill copy loads the published primary file for imported Agent skills", () => {
  assert.match(page, /adminSkillsApi\.getVersion\(editing\.id, editing\.currentVersionId\)/);
  assert.match(page, /primaryFilePath/);
  assert.match(page, /primary\?\.content/);
  assert.match(page, /<SkillCopyAiButton/);
});

test("AI skill copy uses a durable text task and validates structured output", () => {
  assert.match(button, /handler: "skill_text_completion"/);
  assert.match(button, /strictJson: true/);
  assert.match(button, /requireDurableJournal: true/);
  assert.match(button, /retainAccepted: true/);
  assert.match(button, /parseGeneratedSkillCopy/);
  assert.match(button, /usageScenario/);
  assert.match(button, /outputDescription/);
  assert.match(button, /modelPromptLimitIssue/);
});

test("AI skill copy only fills blanks and blocks unsafe save or close races", () => {
  assert.match(page, /current\.description\.trim\(\) \? current\.description : copy\.description/);
  assert.match(page, /current\.usageScenario\.trim\(\) \? current\.usageScenario : copy\.usageScenario/);
  assert.match(page, /if \(copyAiBusy\)/);
  assert.match(page, /closeable=\{!coverAiBusy && !copyAiBusy\}/);
  assert.match(button, /aiApi\.cancelTask/);
  assert.match(button, /commitAcceptedAiGeneration/);
  assert.match(css, /adm-skill-copy-ai/);
});
