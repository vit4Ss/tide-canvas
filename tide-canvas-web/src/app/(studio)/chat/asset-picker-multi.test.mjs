import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");
const dialog = read("./_components/reference-popovers.tsx");
const page = read("./page.tsx");
const references = read("./_hooks/use-references.ts");
const refThumb = read("./_components/ref-thumb.tsx");
const browser = read("../../../components/studio/assets-browser.tsx");
const styles = read("../../../styles/liuguang/studio.css");

test("聊天资产选择器支持受上限约束的多选并集中确认", () => {
  assert.match(dialog, /useState<Map<string, PickedAsset>>/);
  assert.match(dialog, /multiPick/);
  assert.match(dialog, /pickedUrls={pickedUrls}/);
  assert.match(dialog, /disabledPickUrls={existing}/);
  assert.match(dialog, /const selectedRef = useRef\(selected\)/);
  assert.match(dialog, /pickLimitReached={limitReached}/);
  assert.doesNotMatch(dialog, /setSelected\(\(current\) =>[\s\S]*?toast\.info/);
  assert.match(dialog, /`已选 \$\{selected\.size\} 项 · 还可选 \$\{Math\.max\(0, remaining - selected\.size\)\} 项`/);
  assert.match(dialog, /onPick\(\[\.\.\.selected\.values\(\)\]\)/);
  assert.match(dialog, /const \[confirming, setConfirming\] = useState\(false\)/);
  assert.match(dialog, /const confirmingRef = useRef\(false\)/);
  assert.match(dialog, /aria-busy=\{confirming\}/);
  assert.match(dialog, /if \(confirmingRef\.current \|\| selected\.size === 0\) return/);
  assert.match(page, /existingCount={refsApi\.refs\.filter/);
  assert.match(page, /onPick={refsApi\.chooseAssets}/);
  assert.match(references, /const accepted: RefItem\[\] = \[\]/);
  assert.match(references, /if \(accepted\.length\) commitRefs\(\(prev\) => \[\.\.\.prev, \.\.\.accepted\]\)/);
  assert.match(references, /setAssetPickOpen\(false\)[\s\S]*?startTransition\(\(\) =>/);
  assert.doesNotMatch(references, /for \(const asset of assets\)[\s\S]*?addAssetRef\(/);
  assert.match(refThumb, /ossDisplayUrl\(src, 160\) \?\? src/);
  assert.match(refThumb, /loading="lazy"[\s\S]*?decoding="async"/);
  assert.match(browser, /pickMode && multiPick && <SelectBadge selected={pickSelected}/);
  assert.match(styles, /\.ws-assetbox-f\{/);
});

test("资产库 URL 没有扩展名时按已分类媒体类型继续回填", () => {
  assert.match(references, /const assetName = asset\.name \|\| fileNameFromUrl\(asset\.url\)/);
  assert.match(references, /const extension = extOf\(assetName\)/);
  assert.match(references, /if \(policy\.exts && extension && !policy\.exts\.includes\(extension\)\)/);
  assert.doesNotMatch(references, /policy\.exts && !policy\.exts\.includes\(extOf\(asset\.name \|\| fileNameFromUrl\(asset\.url\)\)\)/);
});
