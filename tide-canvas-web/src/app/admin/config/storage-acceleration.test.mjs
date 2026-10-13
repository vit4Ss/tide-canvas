import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

test("存储传输加速配置使用不可删除的后台开关", () => {
  assert.match(page, /"storage\.ossAccelerateEnabled": \{/);
  assert.match(page, /"storage\.ossUploadAccelerateEnabled": \{/);
  assert.match(page, /浏览器直传和后端上传均使用 OSS 加速域名/);
  assert.match(page, /不影响上传加速/);
  assert.match(page, /"storage\.ossAccelerateEnabled",[\s\S]*?\]\);/);
  assert.match(page, /"storage\.ossUploadAccelerateEnabled",[\s\S]*?\]\);/);
});
