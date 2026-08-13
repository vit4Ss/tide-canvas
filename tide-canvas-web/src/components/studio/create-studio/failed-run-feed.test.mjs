import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const here = new URL(".", import.meta.url);
const read = (relative) => readFileSync(new URL(relative, here), "utf8");

test("failed server tasks become history rows before result URL rendering", () => {
  const source = read("./utils.ts");
  const failureBranch = source.indexOf("if (failed || missingResult)");
  const mediaGuard = source.indexOf("if (!mappedType) continue", failureBranch);
  const failureStatus = source.indexOf('status: "failed"', failureBranch);
  const terminalGate = source.indexOf("t.status !== AiTaskStatus.SUCCESS", failureBranch);
  const successStatus = source.indexOf('status: "success"', terminalGate);

  assert.ok(failureBranch >= 0);
  assert.ok(mediaGuard > failureBranch);
  assert.ok(failureStatus > failureBranch);
  assert.ok(terminalGate > failureStatus);
  assert.ok(successStatus > terminalGate);
  assert.match(source, /t\.errorMsg\?\.trim\(\) \|\| "生成服务未返回具体失败原因，请稍后重试"/);
});

test("a live task failure is retained in the feed instead of only showing a toast", () => {
  const source = read("./use-generation.ts");
  const failureHandler = source.indexOf("const fail = (msg?: string)");
  const nextHandler = source.indexOf("let transientFailures", failureHandler);
  const block = source.slice(failureHandler, nextHandler);

  assert.ok(failureHandler >= 0);
  assert.match(block, /status: "failed"/);
  assert.match(block, /setHist\(\(prev\) =>/);
  assert.match(block, /errorMsg/);
});

test("failed rows visibly render the reason and do not offer a fake download", () => {
  const source = read("./stage-feed.tsx");

  assert.match(source, />生成失败<\/span>/);
  assert.match(source, /className="ws-run-failure" role="group" aria-label="生成失败"/);
  assert.match(source, />失败原因<\/span>/);
  assert.match(source, /r\.errorMsg \|\|/);
  assert.match(source, /r\.status !== "failed" && \(\s*<button type="button" onClick=\{\(\) => downloadRun\(r\)\}/);
});
