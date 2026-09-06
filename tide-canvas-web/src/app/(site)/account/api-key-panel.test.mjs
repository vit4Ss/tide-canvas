import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

// Execute the component's actual asynchronous logic with controlled network
// replies and lifecycle events; no request touches a real credential.
const source = readFileSync(new URL("./api-key-panel.tsx", import.meta.url), "utf8");
const body = source.slice(source.indexOf("export function ApiKeyPanel"), source.indexOf("  return (\n    <section")).replace("export function", "function");
const code = ts.transpileModule(`${body}\n globalThis.panel = { act, reload };\n}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const info = { hint: "masked-key", revision: 1, enabled: true };

function setup() {
  const hooks = [], scheduled = [], listeners = new Map(), timers = new Map();
  const metadata = [], reveals = [], copies = [], requests = [];
  let cursor = 0, timerId = 0;
  const context = vm.createContext({
    userApiKeyApi: {
      get: account => { requests.push(["get", account]); return new Promise(resolve => metadata.push(resolve)); },
      reveal: (account, revision) => { requests.push(["reveal", account, revision]); return new Promise(resolve => reveals.push(resolve)); },
    },
    toast: { success() {}, error() {} }, confirmDialog: async () => false,
    navigator: { clipboard: { writeText: async value => copies.push(value) } },
    document: { hidden: false, addEventListener: (name, cb) => listeners.set(name, cb), removeEventListener: name => listeners.delete(name) },
    window: {
      addEventListener: (name, cb) => listeners.set(name, cb), removeEventListener: name => listeners.delete(name),
      setTimeout: (cb, delay) => { timers.set(++timerId, {cb, delay}); return timerId; }, clearTimeout: id => timers.delete(id),
    },
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
  const ready = async () => { metadata.shift()({success: true, data: info}); await Promise.resolve(); render(); };
  const visibility = hidden => { context.document.hidden = hidden; listeners.get("visibilitychange")?.(); };
  render();
  return {context, hooks, metadata, reveals, copies, requests, timers, listeners, render, ready, visibility,
    unmount: () => { for (const hook of hooks) hook.cleanup?.(); }};
}

test("hiding during initial metadata loading does not leave the panel stuck", async () => {
  const h = setup();
  h.visibility(true);
  await h.ready();
  assert.equal(h.hooks[0].value.hint, "masked-key");
  assert.equal(h.hooks[1].value, "");
});

test("a delayed reveal cannot reappear after hiding and returning to the tab", async () => {
  const h = setup(); await h.ready();
  const action = h.context.panel.act("show");
  h.visibility(true); h.visibility(false);
  h.reveals.shift()({success: true, data: {key: "test-secret", revision: 1}});
  await action;
  assert.equal(h.hooks[1].value, "");
  assert.deepEqual(h.requests.at(-1), ["reveal", "owner-a", 1]);
});

test("session changes discard in-flight copies and clear existing key metadata", async () => {
  const h = setup(); await h.ready();
  const action = h.context.panel.act("copy");
  h.listeners.get("storage")({key: "access_token"});
  h.reveals.shift()({success: true, data: {key: "old-account-secret", revision: 1}});
  await action;
  assert.equal(h.hooks[0].value, null);
  assert.equal(h.hooks[1].value, "");
  assert.equal(h.copies.length, 0);
});

test("unmounted panels discard late secrets and visible secrets auto-hide", async () => {
  const gone = setup(); await gone.ready();
  const pending = gone.context.panel.act("show"); gone.unmount();
  gone.reveals.shift()({success: true, data: {key: "late-secret", revision: 1}});
  await pending;
  assert.equal(gone.hooks[1].value, "");

  const live = setup(); await live.ready();
  const action = live.context.panel.act("show");
  live.reveals.shift()({success: true, data: {key: "visible-secret", revision: 1}});
  await action; live.render();
  assert.equal(live.hooks[1].value, "visible-secret");
  const timer = Array.from(live.timers.values())[0];
  assert.equal(timer.delay, 60000); timer.cb();
  assert.equal(live.hooks[1].value, "");
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
