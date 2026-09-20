import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const library = readFileSync(new URL("./skill-library.tsx", import.meta.url), "utf8");
const detail = readFileSync(new URL("./skill-library-detail.tsx", import.meta.url), "utf8");
const button = readFileSync(new URL("./skill-copy-button.tsx", import.meta.url), "utf8");

test("catalog and detail install buttons share the exact personalized copy flow", () => {
  assert.match(library, /<SkillCopyButton skill=\{skill\} className=\{styles\.copyButton\} \/>/);
  assert.match(detail, /<SkillCopyButton skill=\{skill\} className=\{styles\.primaryButton\} \/>/);
  assert.doesNotMatch(library, /<SkillCopyButton[^>]+(?:origin|format)=/);
  assert.doesNotMatch(detail, /<SkillCopyButton[^>]+(?:origin|format)=/);
  assert.match(button, /copySkillSetup\(skill, window\.location\.origin, format, controller\.signal\)/);
  assert.match(button, /result\.includesKey/);
  assert.match(button, /已复制，已包含当前账号的 API Key/);
});
