import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const compiled=ts.transpileModule(readFileSync(new URL("./image-slice.ts",import.meta.url),"utf8"),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText;

function harness({loaded=false,fetcher}={}){
  const state={created:[],revoked:[],requests:[]};
  class FakeImage {
    constructor(){state.created.push(this);}
    set src(value){this.source=value;if(value&&loaded)queueMicrotask(()=>this.onload?.());}
  }
  const sandbox={exports:{},DOMException,Image:FakeImage,queueMicrotask,
    URL:{createObjectURL:()=>"blob:source",revokeObjectURL:url=>state.revoked.push(url)},
    fetch:async(url,init)=>{
      state.requests.push({url,init});
      return fetcher?fetcher(url,init):{ok:true,blob:async()=>({type:"image/png"})};
    },
  };
  vm.runInNewContext(compiled,sandbox);
  return {load:sandbox.exports.loadImageViaProxy,state};
}

test("closing the mask editor cancels its pending network request",async()=>{
  const controller=new AbortController();
  const {load,state}=harness({fetcher:(_url,init)=>new Promise((_resolve,reject)=>{
    init.signal.addEventListener("abort",()=>reject(new DOMException("cancelled","AbortError")),{once:true});
  })});
  const loading=load("https://cdn.example/source.png",controller.signal);
  assert.equal(state.requests[0].init.signal,controller.signal);
  controller.abort();
  await assert.rejects(loading,{name:"AbortError"});
  assert.equal(state.created.length,0);
});

test("a stalled image decoder is cancelled and releases its Blob URL",async()=>{
  const controller=new AbortController();
  const {load,state}=harness();
  const loading=load("https://cdn.example/source.png",controller.signal);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(state.created.length,1);
  controller.abort();
  await assert.rejects(loading,{name:"AbortError"});
  assert.deepEqual(state.revoked,["blob:source"]);
  assert.equal(state.created[0].source,"");
  assert.equal(state.created[0].onload,null);
});

test("cancelled loads do no work, and existing unsignalled callers still succeed",async()=>{
  const {load,state}=harness({loaded:true});
  const controller=new AbortController();controller.abort();
  await assert.rejects(load("https://cdn.example/source.png",controller.signal),{name:"AbortError"});
  assert.equal(state.requests.length,0);
  const result=await load("https://cdn.example/source.png");
  assert.equal(result.mimeType,"image/png");
  assert.equal(result.objUrl,"blob:source");
  assert.deepEqual(state.revoked,[]);
});
