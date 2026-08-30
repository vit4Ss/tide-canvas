import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const types = readFileSync(new URL("../../../types/admin-generations.ts", import.meta.url), "utf8");
const styles = readFileSync(new URL("../../../styles/liuguang/admin.css", import.meta.url), "utf8");

test("generation records expose a debounced user filter beside the date range", () => {
  assert.match(page, /const \[userKeyword, setUserKeyword\] = useState\(""\)/);
  assert.match(page, /userKeyword: userKeyword\.trim\(\) \|\| undefined/);
  assert.match(page, /placeholder="用户名 \/ 邮箱 \/ ID"/);
  assert.match(page, /autoComplete="off"[\s\S]*?spellCheck=\{false\}[\s\S]*?maxLength=\{100\}/);
  assert.match(page, /value=\{userKeyword\}[\s\S]*?applyFilter\(setUserKeyword\)/);
  assert.match(page, /Boolean\(userKeyword\.trim\(\)\)/);
  assert.match(page, /setUserKeyword\(""\)/);
  assert.match(types, /userKeyword\?: string/);
});

test("generation user filter has a compact responsive control style", () => {
  assert.match(styles, /\.genr-user-filter \{[\s\S]*?width: 210px[\s\S]*?height: 32px/);
  assert.match(styles, /\.genr-user-filter:focus-within[\s\S]*?border-color: var\(--accent\)/);
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*?\.genr-user-filter[\s\S]*?width: 100%/);
});
