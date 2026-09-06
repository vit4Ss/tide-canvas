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

function entryHarness({ ancestor } = {}) {
  const hooks = [], effects = [], navigations = [], escapes = [];
  let cursor = 0, sessionToken = "account-a-token", finishLaunch;
  const store = {user:{id:"a",points:20}, ensureSession:async()=>true, fetchUser:async()=>{}};
  const useAuthStore = Object.assign(selector => selector(store), {getState:()=>store});
  const context = {exports:{}, URL,
    localStorage:{getItem:()=>sessionToken},
    window:(()=>{
      const self={location:{replace:url=>navigations.push(url),assign:url=>navigations.push(url)}};
      self.self=self;
      // "opaque" models a foreign ancestor: reading window.top throws, exactly
      // as a cross-origin embedder behaves.
      if(ancestor==="opaque"){Object.defineProperty(self,"top",{get(){throw new Error("cross-origin");}});}
      else if(ancestor){self.top={location:{replace:url=>escapes.push(url)}};}
      else self.top=self;
      return self;
    })(),
    require(name) {
      if(name.endsWith(".css")) return {};
      if(name === "react") return {
        useState:initial=>{const index=cursor++; hooks[index]??={value:initial}; return [hooks[index].value,value=>{hooks[index].value=value;}];},
        useRef:initial=>hooks[cursor++]??={current:initial},
        useEffect:effect=>{cursor++; if(effects.length===0)effects.push(effect);},
        useCallback:fn=>{cursor++; return fn;},
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
  const find=(node,match)=>{
    if(!node||typeof node!=="object")return null;
    if(match(node))return node;
    return [node.props?.children].flat().map(child=>find(child,match)).find(Boolean);
  };
  return {hooks,navigations,escapes,render,find,
    start:()=>{render();return effects[0]();},
    connect:()=>find(render(),node=>node.type==="button").props.onClick(),
    resync:()=>find(render(),node=>node.type==="button"&&String(node.props?.title||"").includes("同步")).props.onClick(),
    finishLaunch:(...args)=>finishLaunch(...args),
    rotateSession:()=>{sessionToken="account-b-token";},
    get user(){return store.user;},
    get frame(){return find(render(),node=>node.type==="iframe");}};
}

test("entry discards an old-account launch even before cross-tab user metadata catches up", async () => {
  const h = entryHarness();
  const cleanup = h.start(); await flush();
  const action = h.connect();
  h.rotateSession();
  h.finishLaunch({success:true,data:{url:origin+"/flowinglight/connect?ticket=old"}});
  await action;
  assert.equal(h.user.id,"a");
  assert.equal(h.navigations.length,0);
  assert.equal(h.frame,undefined,"a discarded launch must not be embedded");
  assert.match(h.hooks[1].value,/登录状态/);
  cleanup();
});

test("a connected chat is embedded in this page instead of navigating away", async () => {
  const h = entryHarness();
  const cleanup = h.start(); await flush();
  const action = h.connect();
  const url = origin + "/flowinglight/connect?ticket=fresh";
  h.finishLaunch({success:true,data:{url}});
  await action;
  assert.equal(h.navigations.length,0,"the embed must not replace the main window");
  const frame = h.frame;
  assert.ok(frame,"the chat is not embedded");
  assert.equal(frame.props.src,url);
  // The escape hatch stays available when a browser refuses to frame the chat.
  const link = h.find(h.render(),node=>node.type==="a"&&node.props?.target==="_blank");
  assert.equal(link.props.href,url);
  assert.equal(link.props.rel,"noreferrer noopener");
  cleanup();
});

test("an off-origin launch URL is never embedded", async () => {
  const h = entryHarness();
  const cleanup = h.start(); await flush();
  const action = h.connect();
  h.finishLaunch({success:true,data:{url:"https://evil.example/flowinglight/connect?ticket=x"}});
  await action;
  assert.equal(h.frame,undefined);
  assert.match(h.hooks[1].value,/聊天地址/);
  cleanup();
});

test("the chat host bouncing a lost session back here escapes the embed", async () => {
  const h = entryHarness({ancestor:"main"});
  const cleanup = h.start(); await flush();
  // Nesting this entry inside the chat would offer "进入 AI 聊天" within the
  // chat itself; the real window must be taken back to the entry instead.
  assert.deepEqual(h.escapes,["/ai-chat"]);
  assert.equal(h.navigations.length,0);
  cleanup?.();
});

test("a foreign ancestor cannot be navigated and does not break the page", async () => {
  const h = entryHarness({ancestor:"opaque"});
  const cleanup = h.start(); await flush();
  assert.deepEqual(h.escapes,[]);
  assert.equal(h.navigations.length,0);
  cleanup?.();
});

test("re-syncing pushes a fresh connection so edited model prices reach the picker", async () => {
  const h = entryHarness();
  const cleanup = h.start(); await flush();
  const first = h.connect();
  h.finishLaunch({success:true,data:{url:origin+"/flowinglight/connect?ticket=one"}});
  await first;
  assert.match(h.frame.props.src,/ticket=one/);

  // The chat stores model names itself, so a price change only lands on the
  // next binding: re-syncing must ask for a new ticket, not reuse the spent one.
  const again = h.resync();
  h.finishLaunch({success:true,data:{url:origin+"/flowinglight/connect?ticket=two"}});
  await again;
  assert.match(h.frame.props.src,/ticket=two/);
  assert.equal(h.navigations.length,0);
  cleanup();
});
