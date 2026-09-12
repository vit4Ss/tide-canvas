import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const modal = readFileSync(new URL("./_components/skill-import-modal.tsx", import.meta.url), "utf8");
const page = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const api = readFileSync(new URL("../../../lib/admin-skills-api.ts", import.meta.url), "utf8");

test("Skill import accepts ZIP archives through a server-side safety preview", () => {
  assert.match(modal, /accept="\.md,\.txt,\.zip,\.skill,/);
  assert.match(modal, /adminSkillsApi\.previewArchive\(archive\)/);
  assert.match(api, /\/api\/admin\/skills\/archive-preview/);
  assert.match(api, /form\.append\("file", file\)/);
  assert.doesNotMatch(modal + api, /JSZip|zip\.js|fflate/);
  assert.match(modal, /MAX_PRIMARY_FILE_BYTES/);
  assert.match(modal, /主文件\/展开上下文 1 MB/);
  assert.match(modal, /archive:\$\{archiveIndex\}/);
  assert.match(modal, /file:\$\{itemIndex\}/);
});

test("archive import communicates ignored executable files and retains the existing JSON import", () => {
  assert.match(modal, /已忽略.*包外或非文本文件/);
  assert.match(modal, /pkg\.files/);
  assert.match(modal, /adminSkillsApi\.importSkills\(skills\)/);
  assert.match(modal, /status: 0/);
});

test("Skill import preflights the exact package and renders package-level failure reasons", () => {
  const validateAt = modal.indexOf("adminSkillsApi.validateImport(skills)");
  const importAt = modal.indexOf("adminSkillsApi.importSkills(skills)");
  assert.ok(validateAt >= 0, "missing import preflight");
  assert.ok(importAt > validateAt, "final import must happen after preflight");
  assert.match(api, /\/api\/admin\/skills\/validate-import/);
  assert.match(modal, /导入校验未通过/);
  assert.match(modal, /item\.errors\.join/);
  assert.match(modal, /未写入任何 Skill/);
  assert.match(page, /adminSkillsApi\.validateImport\(\[skillPackage\]\)/);
  assert.ok(
    page.indexOf("adminSkillsApi.importSkills([skillPackage])") >
      page.indexOf("adminSkillsApi.validateImport([skillPackage])"),
    "manual creation must import only after preflight",
  );
  assert.match(page, /创建前校验未通过/);
  assert.match(page, /setEditorError\(message\)/);
});
