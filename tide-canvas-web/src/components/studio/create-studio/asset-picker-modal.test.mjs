import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");
const modal = read("./asset-picker-modal.tsx");
const slots = read("./use-upload-slots.ts");
const generation = read("./use-generation.ts");
const browser = read("../assets-browser.tsx");
const styles = read("../../../styles/liuguang/studio.css");
const nextConfig = read("../../../../next.config.ts");

test("创作台资产多选只更新变化的卡片并保持连续点击响应", () => {
  assert.match(modal, /const toggleAsset = useCallback/);
  assert.match(browser, /pickSelected={!!multiPick[\s\S]*?pickedUrls\?\.has\(pickUrl\)}/);
  assert.match(browser, /pickDisabled={!!pickUrl[\s\S]*?disabledPickUrls\?\.has\(pickUrl\)}/);
  assert.doesNotMatch(browser, /<TaskCard[\s\S]*?pickedUrls={pickedUrls}/);
  assert.doesNotMatch(browser, /<UploadCard[\s\S]*?pickedUrls={pickedUrls}/);
  assert.match(browser, /SelectBadge selected={pickSelected} disabled={pickDisabled}/);
  assert.match(styles, /\.as-card\.is-pick-disabled\{cursor:not-allowed;/);
  assert.match(styles, /\.as-select-badge\{[\s\S]*?pointer-events:none;/);
  assert.match(modal, /const selectedRef = useRef\(selected\)/);
  assert.match(modal, /pickLimitReached={limitReached}/);
  assert.doesNotMatch(modal, /setSelected\(\(current\) =>[\s\S]*?toast\.info/);
  assert.match(browser, /ossDisplayUrl\(coverSource, 384\)/);
  assert.match(styles, /\.ws-assetbox \.as-card\{contain:layout paint style;/);
  assert.match(styles, /\.ws-assetbox \.as-card\.is-pick-disabled:hover/);
});

test("资产弹窗只解码真实缩略图并避免全屏 GPU 模糊合成", () => {
  assert.match(nextConfig, /hostname: "test-cdn\.mbfczzzz\.top"/);
  assert.match(browser, /fetchPriority="low"/);
  assert.match(browser, /fallbackOssDisplayImage\(event\.currentTarget, null\)/);
  assert.doesNotMatch(styles, /\.ws-srcmask\{[^}]*backdrop-filter/);
  assert.match(styles, /\.asset-group\{[^}]*content-visibility:auto;[^}]*contain-intrinsic-size:auto 320px;/);
  assert.doesNotMatch(styles, /\.as-card \.vbadge\{[^}]*backdrop-filter/);
  assert.doesNotMatch(styles, /\.as-card\.as-up \.as-up-badge\{[^}]*backdrop-filter/);
});

test("创作台资产确认有防重复状态并在异步检查前关闭弹窗", () => {
  assert.match(modal, /const confirmingRef = useRef\(false\)/);
  assert.match(modal, /if \(confirmingRef\.current \|\| assets\.length === 0\) return/);
  assert.match(modal, /aria-busy={confirming}/);
  assert.match(modal, /已达到上限，请取消一项后再选/);
  assert.match(slots, /const k = assetPick;[\s\S]*?setAssetPick\(null\);[\s\S]*?await Promise\.all/);
});

test("视频参考图在本地上传和资产库选取时都提前校验长宽比", () => {
  assert.match(slots, /tool === "i2v" \|\| tool === "flf" \|\| tool === "ref"/);
  assert.match(slots, /measureImageSize\(blobUrl\)/);
  assert.match(slots, /measureImageSize\(ossDisplayUrl\(a\.url, 96\) \?\? a\.url\)/);
  assert.match(slots, /videoReferenceImageAspectIssue/);
  assert.match(slots, /files\.filter\(\(file\) => !file\.aspectIssue\)/);
  assert.match(generation, /const unknownVideoReferenceFiles =/);
  assert.match(generation, /await Promise\.all\([\s\S]*?measureImageSize\(ossDisplayUrl\(source, 96\) \?\? source\)/);
  assert.match(generation, /generationValidationSignatureRef\.current !== validationSignature/);
  assert.match(generation, /markRequiredField\("#dropFiles"\)/);
});
