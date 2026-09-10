import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import {MAX_PANORAMA_SOURCE_PIXELS} from './panorama-projection.ts';

const code=ts.transpileModule(readFileSync(new URL('./panorama-export.ts',import.meta.url),'utf8')
  .replace('import.meta.url',JSON.stringify(import.meta.url)),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
}).outputText;
const view={width:2560,height:1440,yaw:180,pitch:0,verticalFov:74};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup({decode}={}) {
  const workers=[],bitmaps=[],timers=new Set(),exports={};
  class Worker {
    constructor(url){assert.match(String(url),/panorama-capture.worker.ts$/);workers.push(this)}
    postMessage(message,transfer){this.message=message;assert.equal(transfer[0],message.bitmap)}
    terminate(){this.terminated=true}
    success(){this.onmessage({data:{...view,blob:new Blob(['png'],{type:'image/png'})}})}
  }
  const createImageBitmap=decode??(async()=>{const bitmap={close(){this.closed=true}};bitmaps.push(bitmap);return bitmap});
  vm.runInNewContext(code,{exports,require:()=>({MAX_PANORAMA_SOURCE_PIXELS}),Blob,URL,DOMException,Worker,OffscreenCanvas:class {},createImageBitmap,
    setTimeout:fn=>{timers.add(fn);return fn},clearTimeout:fn=>timers.delete(fn)});
  return {run:(signal,request=view)=>exports.exportPanorama({naturalWidth:4096,naturalHeight:2048},request,signal),workers,bitmaps,timers};
}

test('exports across nodes are serialized and each completed worker is terminated',async()=>{
  const env=setup();const signal=new AbortController().signal;
  const a=env.run(signal),b=env.run(signal);await tick();assert.equal(env.workers.length,1);
  env.workers[0].success();await a;await tick();assert.equal(env.workers[0].terminated,true);
  assert.equal(env.workers.length,2);env.workers[1].success();await b;
  assert.equal(env.workers[1].terminated,true);assert.equal(env.timers.size,0);
});

test('invalid worker output rejects immediately instead of throwing in the message handler',async()=>{
  for(const data of [null,{}, {blob:new Blob(['jpeg'],{type:'image/jpeg'}),width:2560,height:1440}]) {
    const env=setup();const a=env.run(new AbortController().signal);
    const failed=assert.rejects(a,/结果无效/);await tick();
    assert.doesNotThrow(()=>env.workers[0].onmessage({data}));await failed;
    assert.equal(env.workers[0].terminated,true);assert.equal(env.timers.size,0);
  }
});

test('queued exports retain the view that was requested before camera changes',async()=>{
  const env=setup();const request={...view};
  const result=env.run(new AbortController().signal,request);request.yaw=90;
  await tick();assert.equal(env.workers[0].message.view.yaw,180);
  env.workers[0].success();await result;
});

test('cancelling an active export frees the worker and allows the next image',async()=>{
  const env=setup(),controller=new AbortController();
  const a=env.run(controller.signal);const failed=assert.rejects(a,{name:'AbortError'});await tick();
  controller.abort();await failed;assert.equal(env.workers[0].terminated,true);
  const b=env.run(new AbortController().signal);await tick();env.workers[1].success();await b;
  assert.equal(env.timers.size,0);
});

test('a bitmap which finishes decoding after abort is closed without starting a worker',async()=>{
  let decoded;const env=setup({decode:()=>new Promise(resolve=>{decoded=resolve})});
  const controller=new AbortController();const a=env.run(controller.signal);
  const failed=assert.rejects(a,{name:'AbortError'});await tick();controller.abort();await failed;
  const bitmap={close(){this.closed=true}};decoded(bitmap);await tick();
  assert.equal(bitmap.closed,true);assert.equal(env.workers.length,0);
});

test('hung worker times out and late output cannot revive the rejected export',async()=>{
  const env=setup();const a=env.run(new AbortController().signal);const failed=assert.rejects(a,/超时/);await tick();
  for(const timer of env.timers)timer();await failed;
  assert.equal(env.workers[0].terminated,true);env.workers[0].success();assert.equal(env.timers.size,0);
});
