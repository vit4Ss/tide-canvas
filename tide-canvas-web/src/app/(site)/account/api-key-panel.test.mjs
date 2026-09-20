import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

// Execute the component's actual asynchronous logic with controlled network
// replies and lifecycle events; no request touches a real credential.
const source = readFileSync(new URL("./api-key-panel.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const start = source.indexOf("export function ApiKeyPanel");
const end = source.indexOf("  return (\n    <section");
assert.ok(start > 0 && end > start, "component layout changed; update the test slice");
const body = source.slice(start, end).replace("export function", "function");
const code = ts.transpileModule(`${body}\n globalThis.panel = { act };\n}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const info = { hint: "masked-key", revision: 1, enabled: true };

function setup() {
  const hooks = [], scheduled = [], listeners = new Map();
  const metadata = [], reveals = [], copies = [], requests = [], toasts = [];
  let cursor = 0;
  const context = vm.createContext({
    userApiKeyApi: {
      get: account => { requests.push(["get", account]); return new Promise(resolve => metadata.push(resolve)); },
      reveal: (account, revision) => { requests.push(["reveal", account, revision]); return new Promise(resolve => reveals.push(resolve)); },
    },
    toast: { success: message => toasts.push(["success", message]), error: message => toasts.push(["error", message]) },
    navigator: { clipboard: { writeText: async value => copies.push(value) } },
    window: { addEventListener: (name, cb) => listeners.set(name, cb), removeEventListener: name => listeners.delete(name) },
    useState: initial => {
      const index = cursor++;
      hooks[index] ??= {value: initial};
      return [hooks[index].value, value => { hooks[index].value = value; }];
    },
    useRef: initial => { const index = cursor++; return hooks[index] ??= {current: initial}; },
    useEffect: (effect, deps) => {
      const index = cursor++;
      const previous = hooks[index];
      if (previous && deps.every((value, i) => Object.is(value, previous.deps[i]))) return;
      scheduled.push(() => { previous?.cleanup?.(); hooks[index] = {deps, cleanup: effect()}; });
    },
  });
  vm.runInContext(code, context);
  const render = () => { cursor = 0; vm.runInContext("ApiKeyPanel({accountId: 'owner-a'})", context); while (scheduled.length) scheduled.shift()(); };
  const flush = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };
  const keyInfo = () => hooks[0].value, secret = () => hooks[1].value, error = () => hooks[2].value;
  render();
  return {context, metadata, reveals, copies, requests, toasts, listeners, render, flush, keyInfo, secret, error,
    unmount: () => { for (const hook of hooks) hook.cleanup?.(); }};
}

test("the full key loads by itself and copy reuses it without another reveal", async () => {
  const h = setup();
  assert.deepEqual(h.requests, [["get", "owner-a"]]);
  h.metadata.shift()({success: true, data: info}); await h.flush();
  assert.deepEqual(h.requests.at(-1), ["reveal", "owner-a", 1]);
  assert.equal(h.secret(), "");
  h.reveals.shift()({success: true, data: {key: "tc_sk_full", revision: 1}}); await h.flush(); h.render();
  assert.equal(h.keyInfo().hint, "masked-key");
  assert.equal(h.secret(), "tc_sk_full");
  await h.context.panel.act("copy");
  assert.deepEqual(h.copies, ["tc_sk_full"]);
  assert.equal(h.requests.length, 2, "copying an already loaded key must not ask the server again");
  assert.deepEqual(h.toasts.at(-1), ["success", "API Key 已复制"]);
});

test("a reveal failure keeps the masked hint, reports the error and can be retried", async () => {
  const h = setup();
  h.metadata.shift()({success: true, data: info}); await h.flush();
  h.reveals.shift()({success: false, message: "读取失败"}); await h.flush(); h.render();
  assert.equal(h.secret(), "");
  assert.equal(h.error(), "读取失败");
  assert.equal(h.keyInfo().hint, "masked-key");
  const retry = h.context.panel.act("reload");
  h.metadata.shift()({success: true, data: info}); await h.flush();
  h.reveals.shift()({success: true, data: {key: "tc_sk_full", revision: 1}}); await retry; h.render();
  assert.equal(h.secret(), "tc_sk_full");
  assert.equal(h.error(), "");
});

test("session changes discard in-flight replies and clear the displayed key", async () => {
  const h = setup();
  h.metadata.shift()({success: true, data: info}); await h.flush();
  h.listeners.get("storage")({key: "access_token"});
  h.reveals.shift()({success: true, data: {key: "old-account-secret", revision: 1}}); await h.flush(); h.render();
  assert.equal(h.keyInfo(), null);
  assert.equal(h.secret(), "");
  assert.equal(h.copies.length, 0);
  assert.match(h.error(), /登录状态已变化/);
});

test("unmounted panels discard late secrets", async () => {
  const h = setup();
  h.metadata.shift()({success: true, data: info}); await h.flush();
  h.unmount();
  h.reveals.shift()({success: true, data: {key: "late-secret", revision: 1}}); await h.flush();
  assert.equal(h.secret(), "");
});

test("re-enabling a legacy disabled key updates the badge without touching the secret", async () => {
  const h = setup();
  h.metadata.shift()({success: true, data: {...info, enabled: false}}); await h.flush();
  h.reveals.shift()({success: true, data: {key: "tc_sk_full", revision: 1}}); await h.flush(); h.render();
  assert.equal(h.keyInfo().enabled, false);
  h.context.userApiKeyApi.setEnabled = async (account, revision, enabled) => { h.requests.push(["setEnabled", account, revision, enabled]); return {success: true, data: {...info, enabled: true}}; };
  await h.context.panel.act("enable");
  assert.deepEqual(h.requests.at(-1), ["setEnabled", "owner-a", 1, true]);
  assert.equal(h.keyInfo().enabled, true);
  assert.equal(h.secret(), "tc_sk_full");
  assert.deepEqual(h.toasts.at(-1), ["success", "密钥已启用"]);
});

test("the panel offers no reveal toggle, disable or rotate controls", () => {
  const markup = source.slice(end);
  assert.doesNotMatch(markup, /EyeOff|<Eye |显示 API Key|隐藏 API Key/);
  assert.doesNotMatch(markup, />停用<|重置密钥|act\("rotate"\)|act\("toggle"\)/);
  // The only remaining status control re-enables a key disabled before the
  // toggle was removed; it must never render for an enabled key.
  assert.match(markup, /!keyInfo\.enabled\s*\?[^\n]*act\("enable"\)/);
  assert.match(markup, /接入智能体/);
  assert.doesNotMatch(source, /Codex/);
});

test("every key-management request retains the expected account across auth retries", async () => {
  const apiSource = readFileSync(new URL("../../../lib/user-api-key.ts", import.meta.url), "utf8");
  const executable = apiSource.slice(apiSource.indexOf("function keyPath")).replace("export const", "const");
  const apiCode = ts.transpileModule(`${executable}\nglobalThis.api = userApiKeyApi;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const calls = [];
  const context = vm.createContext({http: Object.fromEntries(["get", "post", "put"].map(method => [method, (path, body) => { calls.push({path, body}); return Promise.resolve(); }]))});
  vm.runInContext(apiCode, context);
  await context.api.get("account-a"); await context.api.reveal("account-a", 2);
  await context.api.rotate("account-a", 2); await context.api.setEnabled("account-a", 2, false);
  assert.equal(calls.length, 4);
  for (const call of calls) assert.equal(new URL(call.path, "https://example.test").searchParams.get("accountId"), "account-a");
});
