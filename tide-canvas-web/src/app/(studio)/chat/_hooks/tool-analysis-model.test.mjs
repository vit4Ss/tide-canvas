import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  skillModelSupport,
  supportsMediaAnalysis,
  toolNeedsMediaAnalysisModel,
} from "./tool-analysis-model.ts";

const model = (name, fileUpload, uploadFormats = []) => ({
  id: name,
  name,
  modelKey: name.toLowerCase(),
  type: "text",
  desc: "",
  pointCost: "1",
  config: { fileUpload, uploadFormats },
});

const skill = (kinds) => ({ inputSchema: JSON.stringify({ "x-asset-types": kinds }) });

test("media analysis tools require a file-capable text model", () => {
  assert.equal(toolNeedsMediaAnalysisModel(skill(["video"])), true);
  assert.equal(toolNeedsMediaAnalysisModel(skill(["audio"])), true);
  assert.equal(toolNeedsMediaAnalysisModel(skill(["image", "file"])), false);
  assert.equal(toolNeedsMediaAnalysisModel({ inputSchema: "{" }), false);
});

test("video analysis also requires a model that accepts image frames", () => {
  assert.equal(supportsMediaAnalysis(model("Text", false), true), false);
  assert.equal(supportsMediaAnalysis(model("Documents", true, ["pdf", "docx"]), true), false);
  assert.equal(supportsMediaAnalysis(model("Vision", true, ["jpg", "png"]), true), true);
  const explicitlyDisabled = model("Disabled", false, ["jpg"]);
  explicitlyDisabled.config.paramsSchema = { file_upload: true };
  assert.equal(supportsMediaAnalysis(explicitlyDisabled, true), false);
});

test("a required-asset skill is unavailable on an incompatible selected model", () => {
  const text = model("Text", false);
  const capable = model("Vision", true, ["jpg"]);
  const videoSkill = { ...skill(["video"]), inputSchema: JSON.stringify({
    "x-asset-types": ["video"], required: ["assets"], properties: { assets: { minItems: 1 } },
  }) };
  assert.equal(skillModelSupport(videoSkill, text).supported, false);
  assert.match(skillModelSupport(videoSkill, text).reason, /未开启文件上传/);
  assert.deepEqual(skillModelSupport(videoSkill, capable), { supported: true, acceptsAssets: true });
});

test("optional-reference document skills remain usable but cannot attach files", () => {
  const text = model("Text", false);
  const documentSkill = skill(["image", "file"]);
  assert.deepEqual(skillModelSupport(documentSkill, text), { supported: true, acceptsAssets: false });
});

test("a skill pinned to another model is unavailable", () => {
  const selected = model("Selected", true, ["jpg"]);
  const pinned = { ...skill([]), modelId: "another-model" };
  assert.equal(skillModelSupport(pinned, selected).supported, false);
});

test("every chat tool entry point enforces the selected model capability", () => {
  const page = readFileSync(new URL("../page.tsx", import.meta.url), "utf8");
  const send = readFileSync(new URL("./use-send-message.ts", import.meta.url), "utf8");
  const config = readFileSync(new URL("./use-composer-config.ts", import.meta.url), "utf8");
  const picker = readFileSync(new URL("../../../../components/skill/skill-picker.tsx", import.meta.url), "utf8");
  assert.match(page, /toolSkills\?\.filter\(\(candidate\) => skillModelSupport\(candidate, models\.selModel\)\.supported\)/);
  assert.match(page, /skillUnavailableReason=\{toolUnavailableReason\}/);
  assert.match(page, /setToolSkill\(null\)/);
  assert.match(send, /selectedTool && !selectedToolSupport\.supported/);
  assert.match(config, /if \(!toolModelSupport\.acceptsAssets\) return undefined/);
  assert.match(picker, /aria-disabled=\{!!unavailableReason\}/);
});
