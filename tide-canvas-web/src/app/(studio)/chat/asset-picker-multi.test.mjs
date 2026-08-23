import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");
const dialog = read("./_components/reference-popovers.tsx");
const page = read("./page.tsx");
const references = read("./_hooks/use-references.ts");
const browser = read("../../../components/studio/assets-browser.tsx");
const styles = read("../../../styles/liuguang/studio.css");

test("聊天资产选择器支持受上限约束的多选并集中确认", () => {
  assert.match(dialog, /useState<Map<string, PickedAsset>>/);
  assert.match(dialog, /multiPick/);
  assert.match(dialog, /pickedUrls={pickedUrls}/);
  assert.match(dialog, /disabledPickUrls={existing}/);
  assert.match(dialog, /已选择 \$\{selected\.size\} \/ \$\{remaining\}/);
  assert.match(dialog, /onPick\(\[\.\.\.selected\.values\(\)\]\)/);
  assert.match(page, /existingCount={refsApi\.refs\.filter/);
  assert.match(page, /onPick={refsApi\.chooseAssets}/);
  assert.match(references, /for \(const asset of assets\)/);
  assert.match(references, /if \(kind && addAssetRef/);
  assert.match(browser, /pickMode && multiPick && <SelectBadge selected={pickSelected}/);
  assert.match(styles, /\.ws-assetbox-f\{/);
});
