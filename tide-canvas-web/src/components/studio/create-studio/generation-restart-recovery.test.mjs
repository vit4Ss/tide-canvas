import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./use-generation.ts", import.meta.url), "utf8");

test("创作台不再用本地定时器伪造生成百分比", () => {
  assert.doesNotMatch(source, /local\[i\] = Math\.min\(90, local\[i\] \+ 1\.5\)/);
  assert.match(source, /Only authoritative progress returned by \/api\/ai\/tasks\/:id/);
  assert.match(source, /typeof task\.progress === "number"/);
});
