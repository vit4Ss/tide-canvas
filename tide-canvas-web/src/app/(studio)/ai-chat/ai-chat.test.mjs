import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const origin = "https://chat.example";
const request = "x".repeat(43);
const apiSource = readFileSync(new URL("../../../lib/lobehub-api.ts", import.meta.url), "utf8");
const apiContext = { exports: {}, URL, require: () => ({ http: {} }) };
vm.runInNewContext(ts.transpileModule(apiSource, {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText, apiContext);
const { allowedLobeRedirect } = apiContext.exports;

test("OAuth redirects cannot leave the configured LobeHub origin or registered callbacks", () => {
  for (const path of ["/flowinglight/connect?ticket=x", "/api/auth/callback/generic-oidc?code=x", "/api/auth/oauth2/callback/generic-oidc?code=x"]) {
    assert.equal(allowedLobeRedirect(origin + path, origin), true);
  }
  for (const url of ["javascript:alert(1)", "https://evil.example/flowinglight/connect", "https://chat.example.evil.test/flowinglight/connect", "https://user:pass@chat.example/flowinglight/connect", origin + "/logout", "//chat.example/flowinglight/connect"]) {
    assert.equal(allowedLobeRedirect(url, origin), false, url);
  }
});

function authorizationHarness(requestValue = request, session = async () => true) {
  const refs = [], effects = [], states = [], navigations = [];
  let cursor = 0, approvals = 0, resolveApproval;
  const store = {ensureSession: session};
  const context = {exports: {}, URL, window: {location: {replace: url => navigations.push(url)}},
    require(name) {
      if (name.endsWith(".css")) return {};
      if (name === "react") return {
        useState: initial => [initial, value => states.push(value)],
        useRef: initial => refs[cursor++] ??= {current:initial},
        useEffect: fn => effects.push(fn), Suspense: () => null,
      };
      if (name === "react/jsx-runtime") return {jsx: () => null, jsxs: () => null};
      if (name === "next/navigation") return {useSearchParams: () => new URLSearchParams({request:requestValue})};
      if (name.includes("use-auth-store")) return {useAuthStore: selector => selector(store)};
      if (name.includes("lobehub-api")) return {allowedLobeRedirect, lobeHubApi: {
        config: async () => ({success:true,data:{enabled:true,url:origin}}),
        approve: () => { approvals++; return new Promise(resolve => {resolveApproval = resolve;}); },
      }};
      return {};
    }};
  const source = readFileSync(new URL("./authorize/page.tsx", import.meta.url), "utf8");
  const code = ts.transpileModule(source + "\nglobalThis.renderAuthorize = Authorize;", {compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code, context);
  context.renderAuthorize();
  const effect = effects[0];
  let cleanup = effect();
  return {navigations,states, get approvals(){return approvals;},
    strictRemount: () => {cleanup(); cleanup = effect();}, unmount: () => cleanup(),
    complete: () => resolveApproval({success:true,data:{url:origin+"/api/auth/oauth2/callback/generic-oidc?code=safe"}})};
}
const flush = async () => { for(let i=0;i<12;i++) await Promise.resolve(); };

test("StrictMode effect replay consumes the one-use authorization only once", async () => {
  const h = authorizationHarness();
  h.strictRemount();
  await flush();
  assert.equal(h.approvals, 1);
  h.complete(); await flush();
  assert.equal(h.navigations.length, 1);
});

test("leaving the authorize page prevents late navigation", async () => {
  const h = authorizationHarness(); await flush(); h.unmount();
  h.complete(); await flush();
  assert.equal(h.navigations.length, 0);
});

test("invalid authorization handles never reach the approval endpoint", async () => {
  const h = authorizationHarness("invalid"); await flush();
  assert.equal(h.approvals, 0);
  assert.equal(h.states.length, 1);
});

test("expired main session returns to login with the authorization request intact", async () => {
  const h = authorizationHarness(request, async () => false); await flush();
  assert.equal(h.approvals, 0);
  assert.equal(h.navigations.length, 1);
  const target = new URL(h.navigations[0], "https://main.example");
  assert.equal(target.pathname, "/login");
  assert.equal(target.searchParams.get("redirect"), "/ai-chat/authorize?request=" + request);
});

test("late session failure after unmount does not redirect the user away", async () => {
  let finishSession;
  const h = authorizationHarness(request, () => new Promise(resolve => {finishSession=resolve;}));
  h.unmount(); finishSession(false); await flush();
  assert.equal(h.navigations.length, 0);
  assert.equal(h.approvals, 0);
});

test("entry discards an old-account launch even before cross-tab user metadata catches up", async () => {
  const hooks = [], effects = [], navigations = [];
  let cursor = 0, sessionToken = "account-a-token", finishLaunch;
  const store = {user:{id:"a",points:20}, ensureSession:async()=>true, fetchUser:async()=>{}};
  const useAuthStore = Object.assign(selector => selector(store), {getState:()=>store});
  const context = {exports:{}, URL,
    localStorage:{getItem:()=>sessionToken},
    window:{location:{replace:url=>navigations.push(url),assign:url=>navigations.push(url)}},
    require(name) {
      if(name.endsWith(".css")) return {};
      if(name === "react") return {
        useState:initial=>{const index=cursor++; hooks[index]??={value:initial}; return [hooks[index].value,value=>{hooks[index].value=value;}];},
        useRef:initial=>hooks[cursor++]??={current:initial},
        useEffect:effect=>{cursor++; if(effects.length===0)effects.push(effect);},
      };
      if(name === "react/jsx-runtime") return {jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})};
      if(name.includes("use-auth-store")) return {useAuthStore};
      if(name.includes("lobehub-api")) return {allowedLobeRedirect,lobeHubApi:{
        config:async()=>({success:true,data:{enabled:true,url:origin}}),
        launch:()=>new Promise(resolve=>{finishLaunch=resolve;}),
      }};
      return {};
    }};
  const source=readFileSync(new URL("./page.tsx",import.meta.url),"utf8");
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText,context);
  const render=()=>{cursor=0;return context.exports.default();};
  render(); const cleanup=effects[0](); await flush();
  const findButton=node=>{
    if(!node||typeof node!=="object")return null;
    if(node.type==="button")return node;
    return [node.props?.children].flat().map(findButton).find(Boolean);
  };
  const action=findButton(render()).props.onClick();
  sessionToken="account-b-token";
  finishLaunch({success:true,data:{url:origin+"/flowinglight/connect?ticket=old"}});
  await action;
  assert.equal(store.user.id,"a");
  assert.equal(navigations.length,0);
  assert.match(hooks[1].value,/登录状态/);
  cleanup();
});
