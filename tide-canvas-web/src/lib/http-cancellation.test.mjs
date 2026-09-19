import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { getEventListeners } from "node:events";
import test from "node:test";
import ts from "typescript";

function setup(fetch) {
  const code = ts.transpileModule(readFileSync(new URL("./http.ts",import.meta.url),"utf8"), {
    compilerOptions:{ target:ts.ScriptTarget.ES2020, module:ts.ModuleKind.CommonJS },
  }).outputText;
  const storage = new Map([["access_token","access-old"],["refresh_token","refresh-old"]]);
  const loaded = { exports:{} };
  runInNewContext(code,{
    exports:loaded.exports, module:loaded, require:() => ({}), process:{ env:{} },
    fetch, URL, URLSearchParams, Headers, window:{ location:{ href:"" } },
    localStorage:{ getItem:(key) => storage.get(key) ?? null, setItem:(k,v) => storage.set(k,v), removeItem:(k) => storage.delete(k) },
  });
  return { ...loaded.exports, storage };
}
const reply = (body) => ({ text:async () => JSON.stringify(body) });
const flush = () => new Promise(setImmediate);

test("read cancellation reaches fetch and preserves login credentials", { timeout:2000 }, async () => {
  let received;
  const { http, storage } = setup((_url,init) => new Promise((_resolve,reject) => {
    received = init.signal;
    init.signal.addEventListener("abort",() => reject(Error("aborted")),{ once:true });
  }));
  const controller = new AbortController();
  const pending = http.get("/api/ai/tasks",{ pageNum:1 },{ signal:controller.signal });
  assert.equal(received,controller.signal);
  controller.abort();
  assert.equal((await pending).code,0);
  assert.equal(storage.get("access_token"),"access-old");
});

test("a cancelled poll stops waiting for shared token refresh without cancelling other readers", { timeout:2000 }, async () => {
  let completeRefresh, refreshes = 0, retries = 0;
  const { http } = setup(async (url,init) => {
    if (url === "/api/auth/refresh") {
      refreshes++;
      return new Promise((resolve) => { completeRefresh = resolve; });
    }
    if (init.headers.Authorization === "Bearer access-new") {
      retries++;
      return reply({ success:true, code:200, data:{ records:[] } });
    }
    return reply({ success:false, code:401 });
  });
  const controller = new AbortController();
  const poll = http.get("/api/ai/tasks",undefined,{ signal:controller.signal });
  const other = http.get("/api/points/balance");
  await flush(); assert.equal(refreshes,1);
  controller.abort();
  assert.equal((await poll).code,0);
  assert.equal(getEventListeners(controller.signal,"abort").length,0);
  completeRefresh(reply({ success:true, data:{ accessToken:"access-new", refreshToken:"refresh-new" } }));
  assert.equal((await other).success,true); assert.equal(retries,1);
});

test("a successful token refresh removes the optional read abort listener", { timeout:2000 }, async () => {
  const { http } = setup(async (url,init) => reply(url === "/api/auth/refresh"
    ? { success:true, data:{ accessToken:"access-new", refreshToken:"refresh-new" } }
    : init.headers.Authorization === "Bearer access-new" ? { success:true, code:200 } : { success:false, code:401 }));
  const controller = new AbortController();
  assert.equal((await http.get("/api/ai/tasks",undefined,{ signal:controller.signal })).success,true);
  assert.equal(getEventListeners(controller.signal,"abort").length,0);
});
