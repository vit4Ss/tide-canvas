import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { shouldShowGenerationResult } from "./generation-result-visibility.ts";

test("3D generation details hide the result section in every surface", () => {
  assert.equal(shouldShowGenerationResult("3d"), false);
  assert.equal(shouldShowGenerationResult(" 3D "), false);
  assert.equal(shouldShowGenerationResult("image"), true);
  assert.equal(shouldShowGenerationResult("video"), true);
  assert.equal(shouldShowGenerationResult(undefined), true);
  assert.equal(shouldShowGenerationResult("3d", "image"), false);
  assert.equal(shouldShowGenerationResult("image", "3D"), false);
});

test("admin and user detail drawers both apply the shared visibility policy", () => {
  const admin = readFileSync(new URL("../app/admin/generations/page.tsx", import.meta.url), "utf8");
  const user = readFileSync(new URL("../components/shared/generation-history.tsx", import.meta.url), "utf8");
  assert.match(admin, /shouldShowGenerationResult\(d\.scene\)[\s\S]*?<SecTitle>生成结果<\/SecTitle>/);
  assert.match(user, /shouldShowGenerationResult\(row\.mediaType, detail\?\.mediaType\)[\s\S]*?<SectionTitle>生成结果<\/SectionTitle>/);
});
