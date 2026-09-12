import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const importer = readFileSync(new URL("./_components/skill-import-modal.tsx", import.meta.url), "utf8");
const version = readFileSync(new URL("./_components/skill-version-modal.tsx", import.meta.url), "utf8");
const control = readFileSync(new URL("./_components/skill-manifest-ai-control.tsx", import.meta.url), "utf8");
const presets = readFileSync(new URL("./_components/skill-input-schema-presets.ts", import.meta.url), "utf8");
const skillApi = readFileSync(new URL("../../../lib/skill-api.ts", import.meta.url), "utf8");

test("import keeps Schema under administrator control", () => {
  assert.match(importer, /SKILL_INPUT_PRESETS/);
  assert.match(importer, /skillInputSchemaFor\(inputPreset\)/);
  assert.match(importer, /由管理员选择输入类型，AI 不会修改/);
  assert.match(importer, /由管理员确定最终产物类型，AI 只能据此编排步骤/);
  assert.match(importer, /setPrimaryOutputType/);
  assert.match(importer, /importInputPresets/);
  assert.match(importer, /fallbackImportInputPreset/);
  assert.match(presets, /required: \["prompt"\]/);
  assert.match(presets, /minItems: 2,\s*maxItems: 2/);
  assert.match(presets, /单张图片 \+ 文本/);
  assert.match(presets, /多图参考 \+ 文本/);
  for (const preset of ["text", "image", "images", "keyframes", "video", "audio", "file", "webpage", "mixed"]) {
    assert.match(presets, new RegExp(`key: "${preset}"`));
  }
});

test("AI writes only a constrained Manifest draft without model IDs", () => {
  assert.match(control, /handler: "skill_text_completion"/);
  assert.match(control, /strictJson: true/);
  assert.match(control, /requireDurableJournal: true/);
  assert.match(control, /不允许由 AI 填写模型 ID/);
  assert.match(control, /HANDLERS/);
  assert.match(control, /sanitizeManifest/);
  assert.match(control, /validateHandlerInput/);
  assert.match(control, /当前 Schema 的素材类型不完全匹配/);
  assert.doesNotMatch(control, /"analyze_account"/);
  assert.match(control, /生成步骤必须明确选择生成处理器/);
  assert.match(control, /最终步骤没有产出主输出/);
  assert.match(control, /manifestRequestIssue/);
  assert.match(control, /selectedModels/);
  assert.match(control, /window\.confirm\(`将依次为/);
});

test("generated Manifests require confirmation and still use final import validation", () => {
  assert.match(importer, /manifestForImport/);
  assert.match(importer, /Manifest 草稿/);
  assert.match(importer, /adminSkillsApi\.validateImport\(skills\)/);
  assert.match(importer, /closeable=\{!manifestBusy\}/);
  assert.match(version, /<SkillManifestAiControl/);
  assert.match(version, /versionManifestSignature/);
  assert.match(version, /输入 Schema 模板/);
  assert.match(version, /detectSkillInputPreset/);
  assert.match(version, /closeable=\{!manifestAiBusy\}/);
});

test("selected asset schema is enforced again at every user entry", () => {
  assert.match(skillApi, /rawAllowedAssetTypes/);
  assert.match(skillApi, /unsupportedAssetTypes/);
  assert.match(skillApi, /minItems/);
  assert.match(skillApi, /maxItems/);
  assert.match(skillApi, /请添加恰好/);
});
