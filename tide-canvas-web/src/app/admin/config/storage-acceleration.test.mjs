import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

test("存储传输加速配置使用不可删除的后台开关", () => {
  assert.match(page, /"storage\.ossAccelerateEnabled": \{/);
  assert.match(page, /上传与上游取图使用 OSS 传输加速/);
  assert.match(page, /上传使用地域 OSS，模型取图使用 CDN/);
  assert.match(page, /"storage\.ossAccelerateEnabled",[\s\S]*?\]\);/);
});
