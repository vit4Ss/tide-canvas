import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(here, "page.tsx"), "utf8");
const api = readFileSync(join(here, "../../../lib/admin-social-records-api.ts"), "utf8");
const sidebar = readFileSync(join(here, "../../../components/admin/admin-sidebar.tsx"), "utf8");

test("admin analysis records are a permission-gated standalone module", () => {
  assert.match(sidebar, /href: "\/admin\/analysis-records"/);
  assert.match(sidebar, /perm: "analysis_records"/);
  assert.match(api, /\/api\/admin\/social-records/);
});

test("admin record page exposes operational filters and server pagination", () => {
  for (const label of ["全部记录", "内容分析", "视频下载", "用户名 / 邮箱 / ID", "全部平台", "全部状态"]) {
    assert.ok(page.includes(label), `missing filter: ${label}`);
  }
  assert.match(page, /server=\{\{ page, pageSize: PAGE_SIZE, total, onPage: setPage \}\}/);
  assert.match(page, /target="_blank" rel="noreferrer"/);
});
