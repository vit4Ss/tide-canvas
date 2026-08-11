import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import test from "node:test";

const srcRoot = fileURLToPath(new URL("../../../", import.meta.url));
const sharedPlayer = path.join(srcRoot, "components", "studio", "create-studio", "video-result.tsx");

function tsxFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(full);
    return entry.isFile() && entry.name.endsWith(".tsx") ? [full] : [];
  });
}

test("all native controlled video players use the shared frame-capture player", () => {
  const violations = [];
  for (const file of tsxFiles(srcRoot)) {
    if (file === sharedPlayer) continue;
    const source = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    const tags = source.match(/<video\b[^>]*>/g) ?? [];
    if (tags.some((tag) => /\bcontrols(?:\s|=|\/?>)/.test(tag))) {
      violations.push(path.relative(srcRoot, file));
    }
  }
  assert.deepEqual(violations, []);
});
