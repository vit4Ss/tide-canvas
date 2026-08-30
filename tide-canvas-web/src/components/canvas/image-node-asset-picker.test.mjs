import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const imageNode = readFileSync(new URL("./nodes/image-node.tsx", import.meta.url), "utf8");
const mediaUpload = readFileSync(new URL("./nodes/shared/use-media-upload.ts", import.meta.url), "utf8");
const canvasLayout = readFileSync(new URL("../../app/(canvas)/layout.tsx", import.meta.url), "utf8");
const studioStyles = readFileSync(new URL("../../styles/liuguang/studio.css", import.meta.url), "utf8");

test("empty canvas image nodes expose local upload and asset library sources", () => {
  assert.match(imageNode, /<AssetPickerModal[\s\S]*?kind="image"[\s\S]*?lockKind/);
  assert.match(imageNode, /node\.type === CHARACTER_NODE_TYPE[\s\S]*?\? "character"/);
  assert.match(imageNode, />\s*本地上传\s*</);
  assert.match(imageNode, />\s*资产库\s*</);
  assert.match(imageNode, />\s*从资产库选图\s*</);
  assert.doesNotMatch(imageNode, /图片高清功能即将上线/);
  assert.match(imageNode, /createPortal\([\s\S]*?<AssetPickerModal[\s\S]*?document\.body/);
  assert.match(imageNode, /className="canvas-asset-picker-theme"/);
});

test("asset selection uses the same replacement and size guards as local upload", () => {
  assert.match(mediaUpload, /const applyHostedMedia[\s\S]*?canReplaceCanvasMedia\(current\)/);
  assert.match(mediaUpload, /fileApi\.assetSize\(asset\.url\)/);
  assert.match(mediaUpload, /validateKnownFileSize\(sizeBytes[\s\S]*?resolveModelReferenceLimitBytes\(selectedModel, kind\)/);
  assert.match(mediaUpload, /canCommitCanvasMediaUpload\(latest\)/);
  assert.match(mediaUpload, /patch\.imageSrc = asset\.url[\s\S]*?patch\.images = undefined/);
});

test("canvas route loads the scoped asset browser styles", () => {
  assert.match(canvasLayout, /@\/styles\/liuguang\/studio\.css/);
  assert.match(studioStyles, /\.canvas-asset-picker-theme\{[\s\S]*?--surface:#131316[\s\S]*?--text:#f5f5f7/);
});
