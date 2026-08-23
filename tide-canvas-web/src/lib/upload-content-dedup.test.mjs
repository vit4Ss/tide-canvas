import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");
const api = read("./api.ts");
const assetBrowser = read("../components/studio/assets-browser.tsx");
const videoBreakdown = read("../components/canvas/nodes/video-breakdown-node.tsx");
const videoResult = read("../components/studio/create-studio/video-result.tsx");

test("smart upload hashes content and skips transfer when the owner already has it", () => {
  assert.match(api, /crypto\.subtle\.digest\("SHA-256", await file\.arrayBuffer\(\)\)/);
  assert.match(api, /contentHash = await uploadedFileSHA256\(file\)/);
  assert.match(api, /fileApi\.presign\(\{[\s\S]*contentHash/);
  assert.match(api, /pre\.data\?\.existingFile/);
  assert.match(api, /data: \{ \.\.\.pre\.data\.existingFile, reused: true \}/);
});

test("asset-library batch upload reports reused content separately from new assets", () => {
  assert.match(assetBrowser, /result\.success && result\.data\?\.reused/);
  assert.match(assetBrowser, /const created = ok - reused/);
  assert.match(assetBrowser, /复用 \$\{reused\} 个相同文件/);
});

test("captured-frame promotion preserves reused upload assets", () => {
  assert.match(videoBreakdown, /if \(!uploaded\.data\.reused\)[\s\S]*fileApi\.delete\(uploaded\.data\.id\)/);
  assert.match(videoBreakdown, /moveOriginal: !uploaded\.data\.reused/);
  assert.match(videoBreakdown, /url: registered\.data\.resultUrl \|\| uploaded\.data\.fileUrl/);
  assert.match(videoResult, /moveOriginal: !res\.data\.reused/);
});
