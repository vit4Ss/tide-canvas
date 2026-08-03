import assert from "node:assert/strict";
import test from "node:test";
import {
  HANDLER_MEDIA_KIND,
  assetViewKey,
  filtersForAssetTab,
  initialAssetTab,
} from "./assets-browser-policy.ts";

test("concept and document filters never silently live under generation history", () => {
  assert.equal(initialAssetTab("hist", "character"), "upload");
  assert.equal(initialAssetTab("hist", "scene"), "upload");
  assert.equal(initialAssetTab("hist", "doc"), "upload");
  assert.equal(initialAssetTab("hist", "image"), "hist");
});

test("generation history only exposes filters supported by generated tasks", () => {
  assert.deepEqual(filtersForAssetTab("hist"), ["image", "video", "audio"]);
  assert.deepEqual(filtersForAssetTab("upload"), ["character", "scene", "image", "video", "audio", "doc"]);
});

test("reference-to-video results are classified as video assets", () => {
  assert.equal(HANDLER_MEDIA_KIND.reference_to_video, "video");
});

test("view cache keys isolate tab, filter, dates, and ordering", () => {
  const base = { tab: "hist", filter: "image", startDate: "", endDate: "", sortAsc: false };
  assert.notEqual(assetViewKey(base), assetViewKey({ ...base, filter: "video" }));
  assert.notEqual(assetViewKey(base), assetViewKey({ ...base, sortAsc: true }));
  assert.notEqual(assetViewKey(base), assetViewKey({ ...base, startDate: "2026-08-01" }));
});
