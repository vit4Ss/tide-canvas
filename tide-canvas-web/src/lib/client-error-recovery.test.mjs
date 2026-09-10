import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import {
  claimStaleAssetReload,
  clientErrorReference,
  isStaleClientAssetError,
  scheduleAssetRecovery,
  canAutoRecoverDocument,
} from "./client-error-recovery.ts";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test("recognizes Next, Turbopack, CSS, and browser dynamic import failures", () => {
  assert.equal(isStaleClientAssetError(Object.assign(new Error("network failure"), { name: "ChunkLoadError" })), true);
  assert.equal(isStaleClientAssetError(new Error("Failed to load chunk /_next/static/chunks/old.js")), true);
  assert.equal(isStaleClientAssetError({ code: "CSS_CHUNK_LOAD_FAILED" }), true);
  assert.equal(isStaleClientAssetError(new TypeError("Failed to fetch dynamically imported module")), true);
  assert.equal(isStaleClientAssetError(new Error("ordinary render failure")), false);
});

test("follows nested causes and never exposes messages as the public reference", () => {
  const error = new Error("route failed", { cause: new Error("Importing a module script failed") });
  assert.equal(isStaleClientAssetError(error), true);
  assert.equal(clientErrorReference(error), "STALE_CLIENT_ASSET");
  assert.equal(clientErrorReference(new TypeError("private response body")), "TypeError");
  assert.equal(clientErrorReference(new Error("private response body")), "CLIENT_RENDER_ERROR");
});

test("allows at most two reloads for the same recent route failure", () => {
  const storage = memoryStorage();
  const error = Object.assign(new Error("Failed to load chunk old.js"), { name: "ChunkLoadError" });
  assert.equal(claimStaleAssetReload(error, "/canvas/1", storage, 1_000), true);
  assert.equal(claimStaleAssetReload(error, "/canvas/1", storage, 2_000), true);
  assert.equal(claimStaleAssetReload(error, "/canvas/1", storage, 3_000), false);
  assert.equal(claimStaleAssetReload(new Error("Failed to load chunk new.js"), "/canvas/2", storage, 3_000), false);
  assert.equal(claimStaleAssetReload(error, "/canvas/1", storage, 5 * 60 * 1000 + 4_000), true);
});

test("fails closed when the loop fuse cannot be persisted", () => {
  const denied = {
    getItem: () => { throw new Error("denied"); },
    setItem: () => { throw new Error("denied"); },
  };
  assert.equal(claimStaleAssetReload(new Error("Failed to load chunk old.js"), "/", denied), false);
});

test("ordinary business errors cannot become reloads due to their stack or URL", () => {
  assert.equal(isStaleClientAssetError({message:"bad data",stack:"at ChunkLoadErrorComponent",request:"https://site/Failed to load chunk"}),false);
  const cycle={message:"ordinary"};cycle.cause=cycle;
  assert.equal(isStaleClientAssetError(cycle),false);
  assert.equal(clientErrorReference({name:"private account detail"}),"CLIENT_RENDER_ERROR");
  const hostile=new Proxy({},{get(){throw new Error('getter failed')}});
  assert.equal(isStaleClientAssetError(hostile),false);
  assert.equal(clientErrorReference(hostile),'CLIENT_RENDER_ERROR');
});

test("invalid or silently discarded loop markers fail closed", () => {
  const error = new Error("Failed to load chunk old.js");
  for (const raw of ['{','{}','{"count":null,"savedAt":0}','{"count":-1,"savedAt":0}']) {
    const storage={getItem:()=>raw,setItem:()=>{}};
    assert.equal(claimStaleAssetReload(error,"/",storage,1000),false);
  }
  assert.equal(claimStaleAssetReload(error,"/",{getItem:()=>null,setItem:()=>{}},1000),false);
  assert.equal(claimStaleAssetReload(error,"/",{getItem:()=>'{"count":0,"savedAt":2000}',setItem:()=>{}},1000),false);
});

test("StrictMode cleanup consumes no attempt; blocked/offline paths never reload", () => {
  const error=new Error("Failed to load chunk old.js");
  const tasks=new Set();let claims=0,reloads=0,allowed=true;
  const env={schedule:fn=>{tasks.add(fn);return ()=>tasks.delete(fn);},
    claim:()=>{claims++;return claims<=2},canReload:()=>allowed,reload:()=>{reloads++}};
  const stop=scheduleAssetRecovery(error,env);stop();
  scheduleAssetRecovery(error,env);
  for(const task of tasks) task();tasks.clear();
  assert.equal(claims,1);assert.equal(reloads,1);
  allowed=false;scheduleAssetRecovery(error,env);
  for(const task of tasks) task();tasks.clear();
  assert.equal(claims,1);assert.equal(reloads,1);
  scheduleAssetRecovery(new Error("ordinary"),env);assert.equal(tasks.size,0);
});

test("early CSS and JS recovery share the same budget across loads", () => {
  const source=readFileSync(new URL('../app/layout.tsx',import.meta.url),'utf8');
  const script=source.match(/__html: `([^`]+)`/)[1];
  const storage=memoryStorage();let reloads=0;
  function boot(url, interacted=false, tagName='LINK') {
    const events=new Map();
    const location={href:'https://test.local/studio',origin:'https://test.local',reload:()=>reloads++};
    const window={addEventListener:(name,cb)=>events.set(name,cb),dispatchEvent:()=>true};
    vm.runInNewContext(script,{URL,Event,Date,JSON,Number,navigator:{onLine:true},location,sessionStorage:storage,window});
    if(interacted) events.get('input')({isTrusted:true});
    assert.equal(canAutoRecoverDocument(window),!interacted);
    events.get('error')({target:tagName==='SCRIPT' ? {tagName,src:url} : {tagName,rel:'stylesheet',href:url}});
    events.get('load')?.();
  }
  boot('https://other.local/_next/static/ignored.css');assert.equal(reloads,0);
  boot('https://test.local/_next/static/ignored.css',true);assert.equal(reloads,0);
  boot('https://test.local/_next/static/first.js',false,'SCRIPT');assert.equal(reloads,1);
  boot('https://test.local/_next/static/second.css');assert.equal(reloads,2);
  boot('https://test.local/_next/static/third.css');assert.equal(reloads,2);
  assert.equal(claimStaleAssetReload(new Error('Failed to load chunk x.js'),'/canvas',storage),false);
});
