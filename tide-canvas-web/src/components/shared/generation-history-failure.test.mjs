import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const historySource = readFileSync(new URL("./generation-history.tsx", import.meta.url), "utf8");
const typeSource = readFileSync(new URL("../../types/ai.ts", import.meta.url), "utf8");

test("失败详情明显展示服务端安全原因并保留退款说明", () => {
  assert.match(typeSource, /failureReason\?: string/);
  assert.match(historySource, /\(detail\?\.success \?\? row\.success\) !== 1/);
  assert.match(historySource, /detail\?\.failureReason\?\.trim\(\)/);
  assert.match(historySource, />失败原因<\/span>/);
  assert.match(historySource, /<strong>\{failureReason\}<\/strong>/);
  assert.match(historySource, /生成未完成，本次消耗的积分已退回/);
});
