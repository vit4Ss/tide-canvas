import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import {recentTextHistory} from "../../lib/text-history.ts";
import {normalizeAssistantChatRequest} from "./canvas-assistant-chat-recovery.ts";

const source = readFileSync(new URL("./canvas-assistant-panel.tsx", import.meta.url), "utf8");
const start = source.indexOf("    const recentHistory =");
const end = source.indexOf("    if (currentSkill)", start);
const expression = ts.transpileModule(source.slice(start, end) + "\nglobalThis.history = completedHistory;", {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText;
const assetStart = source.indexOf("      const previousResultAssets =");
const assetEnd = source.indexOf("      const input =", assetStart);
const assetExpression = ts.transpileModule(source.slice(assetStart, assetEnd) + "\nglobalThis.assets = previousResultAssets;", {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText;

test("canvas model and agent input uses the newest three completed messages in order", () => {
  const currentHistory = Array.from({length: 8}, (_, i) => ({role: i % 2 ? "assistant" : "user", status: "done", content: `message-${i}`}));
  currentHistory.push({role: "assistant", status: "error", content: "failed"});
  currentHistory.push({role: "user", status: "done", includeInHistory: false, content: "pending"});
  const context = vm.createContext({currentHistory, recentTextHistory, runsById: new Map(), runsByRequestId: new Map(), messageContentForHistory: item => item.content});
  vm.runInContext(expression, context);
  assert.deepEqual(Array.from(context.history, item => item.content), ["message-5", "message-6", "message-7"]);
  assert.equal(currentHistory.length, 10, "visible history was truncated");
  assert.match(source, /input\.messages = trimSkillHistory\(completedHistory\)/);
  assert.match(source, /messages: completedHistory/);
});

test("new history windows handle empty and short conversations without mutating storage", () => {
  for (const size of [0, 1, 2, 3, 40]) {
    const history = Object.freeze(Array.from({length: size}, (_, i) => `message-${i}`));
    assert.deepEqual(recentTextHistory(history), history.slice(-3));
    assert.equal(history.length, size);
  }
});

test("automatic agent assets follow the same three-message window including recovered runs", () => {
  const run = id => ({id, status: "succeeded", artifacts: [{id: `${id}-image`, type: "image", url: `https://example.com/${id}.png`, isFinal: true}]});
  const oldRun = run("old");
  const keptRun = run("kept");
  const recoveredRun = run("recovered");
  const currentHistory = [
    {role: "assistant", skillRunId: "old", status: "done", content: "old result"},
    {role: "user", status: "done", content: "older request"},
    {role: "assistant", skillRunId: "kept", status: "done", content: "kept result"},
    {role: "user", status: "done", content: "latest request"},
    {role: "assistant", clientRequestId: "recover", includeInHistory: false, status: "error", content: "interrupted"},
    {role: "assistant", skillRunId: "failed", status: "error", content: "failed"},
  ];
  const context = vm.createContext({
    currentHistory, recentTextHistory, currentSkillKind: "agent",
    runsById: new Map([["old", oldRun], ["kept", keptRun], ["failed", {status: "failed"}]]),
    runsByRequestId: new Map([["recover", recoveredRun]]),
    messageContentForHistory: item => item.content,
    skillRunHistoryContent: item => `${item.id} result`,
    canvasSkillRunArtifacts: item => item.artifacts,
  });
  vm.runInContext(expression + assetExpression, context);
  assert.deepEqual(Array.from(context.history, item => item.content), ["kept result", "latest request", "recovered result"]);
  assert.deepEqual(Array.from(context.assets, item => item.id), ["kept-image", "recovered-image"]);
  assert.equal(currentHistory.length, 6);
  assert.match(source, /uniqueSkillAssets\(\[\.\.\.currentAssets, \.\.\.previousResultAssets\]\)/);
});

test("a pre-upgrade recovery payload remains unchanged for idempotency; the server applies the window", () => {
  const request = {clientRequestId: "saved-request", userMessageId: "user", modelId: "model", createdAt: 1, input: {
    prompt: "current", messages: Array.from({length: 40}, (_, i) => ({role: "user", content: `history-${i}`})), attachments: [],
  }};
  assert.deepEqual(normalizeAssistantChatRequest(request), request);
});
