import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

test("generation detail shows the catalog model name in both summary and params", () => {
  assert.match(source, /function displayModelName[\s\S]*?row\.modelName \|\| row\.model \|\| "—"/);
  assert.match(
    source,
    /p\.key\.trim\(\)\.toLowerCase\(\) === "model" \? displayModelName\(d\) : p\.value/,
  );
});

test("raw request and response bodies are rendered only for the administrator role", () => {
  assert.match(
    source,
    /const canViewRawBodies = useAuthStore\(\(s\) => s\.user\?\.role === UserRole\.ADMIN\)/,
  );
  assert.match(
    source,
    /\{canViewRawBodies &&[\s\S]*?d\.requestBody !== undefined \|\| d\.responseBody !== undefined[\s\S]*?<SecTitle>原始报文<\/SecTitle>[\s\S]*?\) : null\}/,
  );
});

test("generation refunds are administrator-only, confirmed, and update the row state", () => {
  assert.match(source, /const isAdministrator = useAuthStore\(\(s\) => s\.user\?\.role === UserRole\.ADMIN\)/);
  assert.match(source, /isAdministrator && !r\.refunded && r\.refundable && r\.pointCost != null && r\.pointCost > 0/);
  assert.match(source, /confirmDialog\(\{[\s\S]*?title: "确认生成记录退款"[\s\S]*?confirmText: "确认退款"/);
  assert.match(source, /adminGenerationsApi\.refund\(row\.id\)[\s\S]*?applyRefundedDetail\(res\.data\)/);
  assert.match(source, /if \(row\.refunded\) return \{ label: "退款", tone: "amber" \}/);
});
