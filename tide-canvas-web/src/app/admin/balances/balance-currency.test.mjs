import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

test("supplier balance dashboard presents one CNY total and CNY warning contract", () => {
  assert.match(source, /const liveCNY = useMemo/);
  assert.match(source, /row\.currency\.toUpperCase\(\) === "CNY"/);
  assert.match(source, /在线人民币余额<em>TOTAL \/ CNY<\/em>/);
  assert.match(source, /formatMoney\(liveCNY, "CNY"\)/);
  assert.match(source, /人民币预警线/);
  assert.doesNotMatch(source, /const liveUSD/);
  assert.doesNotMatch(source, /在线美元余额/);
});

test("supplier configuration exposes native currency and USD-to-CNY rate", () => {
  assert.match(source, /currency: \{ label: "原始计价单位"/);
  assert.match(source, /exchangeRate: \{ label: "美元兑人民币汇率"/);
  assert.match(source, /<option value="CNY">人民币（CNY）<\/option>/);
  assert.match(source, /<option value="USD">美元（USD）<\/option>/);
  assert.match(source, /suffix === "exchangeRate" && sourceCurrency !== "USD"/);
  assert.match(source, /next === "USD" && sourceCurrency !== "USD"/);
  assert.match(source, /setValue\(rateField\.row, ""\)/);
  assert.match(source, /next === "CNY"/);
  assert.match(source, /setValue\(rateField\.row, rateField\.row\.configValue\)/);
});
