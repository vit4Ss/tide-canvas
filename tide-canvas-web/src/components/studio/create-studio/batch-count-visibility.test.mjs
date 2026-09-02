import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");
const studio = read("../create-studio.tsx");
const fields = read("./option-fields.tsx");
const admin = read("../../../app/admin/models/page.tsx");
const types = read("../../../types/admin-models.ts");
const chatConfig = read("../../../app/(studio)/chat/_hooks/use-composer-config.ts");
const chatComposer = read("../../../app/(studio)/chat/_components/composer.tsx");
const imageNode = read("../../canvas/nodes/image-node.tsx");

test("图片模型默认显示生成数量，管理员可显式隐藏", () => {
  assert.match(types, /hideBatchCount\?: boolean/);
  assert.match(admin, /label="隐藏生成数量"/);
  assert.match(admin, /checked=\{cfg\.hideBatchCount === true\}/);
  assert.match(admin, /onChange=\{\(next\) => setC\(\{ hideBatchCount: next \}\)\}/);
  assert.match(studio, /const hideBatchCount = isImage && mCfg\?\.hideBatchCount === true/);
  assert.match(fields, /showCount && !isVideo && !isAudio/);
  assert.match(studio, /showCount=\{!hideBatchCount\}/);
  assert.match(chatComposer, /mCfg\?\.hideBatchCount !== true/);
  assert.match(imageNode, /\{!hideBatchCount && \([\s\S]*?<BatchCountDropdown/);
});

test("隐藏生成数量时计价、提交、草稿和模型切换都固定单张", () => {
  assert.match(studio, /const effectiveCount = hideBatchCount \? 1 : count/);
  assert.match(studio, /Math\.ceil\(per \* effectiveCount\)/);
  assert.match(studio, /Math\.ceil\(flat \* effectiveCount\)/);
  assert.match(studio, /count: effectiveCount,[\s\S]*?tool,/);
  assert.match(studio, /if \(isImage && mCfg\.hideBatchCount === true\) \{\s*setCount\(1\)/);
  assert.match(studio, /count=\{effectiveCount\}/);
  assert.match(chatConfig, /const batch = hideBatchCount \? 1 : batchState/);
  assert.match(chatConfig, /setBatch\(\(b\) => hideBatchCount \? 1/);
  assert.match(chatConfig, /hideBatchCount \|\| openSel !== "count"[\s\S]*?setOpenSel\(null\)/);
  assert.match(imageNode, /const batchOptions = hideBatchCount[\s\S]*?\? \[1\]/);
  assert.match(imageNode, /if \(!hideBatchCount \|\| !batchOpen\) return;[\s\S]*?setBatchOpen\(false\)/);
});
