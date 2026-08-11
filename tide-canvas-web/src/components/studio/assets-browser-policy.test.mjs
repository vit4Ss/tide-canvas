import assert from "node:assert/strict";
import test from "node:test";
import {
  HANDLER_MEDIA_KIND,
  assetViewKey,
  filtersForAssetTab,
  initialAssetTab,
} from "./assets-browser-policy.ts";
import {
  FALLBACK_TOOLS,
  normalizeToolCoverPool,
  resolveToolCoverUrl,
  smartToolOriginLabel,
} from "../../lib/ai-tools-catalog.ts";

test("concept filters are available in both histories while documents stay upload-only", () => {
  assert.equal(initialAssetTab("hist", "character"), "hist");
  assert.equal(initialAssetTab("hist", "scene"), "hist");
  assert.equal(initialAssetTab("hist", "doc"), "upload");
  assert.equal(initialAssetTab("hist", "image"), "hist");
});

test("both histories expose concept filters, while documents stay upload-only", () => {
  assert.deepEqual(filtersForAssetTab("hist"), ["character", "scene", "image", "video", "audio", "3d"]);
  assert.deepEqual(filtersForAssetTab("upload"), ["character", "scene", "image", "video", "audio", "doc"]);
});

test("all video results, including video upscale, are classified as video assets", () => {
  assert.equal(HANDLER_MEDIA_KIND.reference_to_video, "video");
  assert.equal(HANDLER_MEDIA_KIND.video_upscale, "video");
});

test("every smart tool result is classified into its asset media bucket", () => {
  for (const tool of FALLBACK_TOOLS) {
    assert.equal(HANDLER_MEDIA_KIND[tool.handler], tool.type, `${tool.handler} asset type`);
  }
});

test("legacy smart-tool tasks keep safe labels without rewriting stored input", () => {
  assert.equal(smartToolOriginLabel("outpaint", {}), "智能扩图");
  assert.equal(smartToolOriginLabel("video_upscale", "not-json"), "视频超分");
  assert.equal(smartToolOriginLabel("image_to_image", {}), undefined);
});

test("new smart-tool tasks use their recorded title only after key and handler validation", () => {
  assert.equal(
    smartToolOriginLabel("image_to_image", { toolKey: "inpaint", toolTitle: " 局部精修 " }),
    "局部精修",
  );
  assert.equal(smartToolOriginLabel("image_to_image", { toolKey: "inpaint" }), "局部重绘");
  assert.equal(
    smartToolOriginLabel("text_to_image", { toolKey: "inpaint", toolTitle: "错误来源" }),
    undefined,
  );
  assert.equal(
    smartToolOriginLabel("outpaint", JSON.stringify({ toolKey: "expand", toolTitle: "画面扩展" })),
    "画面扩展",
  );
  assert.equal(
    smartToolOriginLabel("outpaint", { toolKey: "expand", toolTitle: "扩".repeat(80) }),
    "扩".repeat(64),
  );
});

test("tool covers prefer admin config and keep legacy fallback stable", () => {
  const pool = [" /cover-a.jpg ", "/cover-b.jpg", "/cover-c.jpg"];
  assert.equal(resolveToolCoverUrl("expand", " https://cdn.test/fixed.jpg ", pool), "https://cdn.test/fixed.jpg");
  assert.equal(resolveToolCoverUrl("expand", "", pool), "/cover-a.jpg");
  assert.equal(resolveToolCoverUrl("inpaint", undefined, pool), "/cover-b.jpg");
  assert.equal(resolveToolCoverUrl("vupscale", null, pool), "/cover-a.jpg");
  assert.equal(resolveToolCoverUrl("expand", "", []), "");
  assert.deepEqual(
    normalizeToolCoverPool([" /a.jpg ", "", "/a.jpg", null, "/b.jpg"]),
    ["/a.jpg", "/b.jpg"],
  );
});

test("3d generations are classified as 3d assets and stay history-only", () => {
  assert.equal(HANDLER_MEDIA_KIND.generate_3d, "3d");
  assert.ok(!filtersForAssetTab("upload").includes("3d"));
});

test("view cache keys isolate tab, filter, dates, and ordering", () => {
  const base = { tab: "hist", filter: "image", startDate: "", endDate: "", sortAsc: false };
  assert.notEqual(assetViewKey(base), assetViewKey({ ...base, filter: "video" }));
  assert.notEqual(assetViewKey(base), assetViewKey({ ...base, sortAsc: true }));
  assert.notEqual(assetViewKey(base), assetViewKey({ ...base, startDate: "2026-08-01" }));
});
