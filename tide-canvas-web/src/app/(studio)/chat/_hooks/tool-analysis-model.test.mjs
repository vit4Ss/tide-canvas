import assert from "node:assert/strict";
import test from "node:test";

import {
  preferredMediaAnalysisModel,
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
});

test("an incompatible selected model falls back to the first capable catalog model", () => {
  const text = model("Text", false);
  const capable = model("Vision", true, ["jpg"]);
  assert.equal(preferredMediaAnalysisModel([text, capable], text, skill(["video"])), capable);
  assert.equal(preferredMediaAnalysisModel([text, capable], capable, skill(["video"])), capable);
});
