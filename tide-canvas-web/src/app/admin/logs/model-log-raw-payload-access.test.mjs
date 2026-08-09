import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

test("model log raw payload fields require administrator role and server-returned data", () => {
  assert.match(
    source,
    /const canViewRawBodies = useAuthStore\(\(s\) => s\.user\?\.role === UserRole\.ADMIN\)/,
  );
  assert.match(
    source,
    /canViewRawBodies &&[\s\S]*?l\.requestBody !== undefined \|\| l\.responseBody !== undefined[\s\S]*?label: "请求体"/,
  );
});
