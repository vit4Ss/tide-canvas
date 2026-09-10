import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import { frameCaptureSeekTarget } from './video-frame-policy.ts';
import { encodeCapturePNG } from './capture-png.ts';

const code=ts.transpileModule(readFileSync(new URL('./video-frame.ts',import.meta.url),'utf8'),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS},
}).outputText;

function setup({failEncode=false,throwLoad=false,throwSeek=false,cleanupThrows=false}={}) {
  const images=[],videos=[],fetches=[],revoked=[];
  let encoded=0;
  const timers=new Map();
  const timeout=(fn,ms)=>{const timer=setTimeout(()=>{timers.delete(timer);fn()},ms);timer.unref();timers.set(timer,ms);return timer};
  const clearTimer=timer=>{timers.delete(timer);clearTimeout(timer)};
  class Video extends EventTarget {
    _time=0;src='';duration=8;videoWidth=640;videoHeight=360;readyState=0;
    load(){
      if(this.src&&throwLoad&&videos.length===1)throw new Error('load failed');
      if(!this.src&&cleanupThrows)throw new Error('cleanup failed');
      if(this.src)queueMicrotask(()=>this.dispatchEvent(new Event('loadedmetadata')))
    }
    removeAttribute(){this.src=''}
    get currentTime(){return this._time}
    set currentTime(value){
      if(throwSeek&&videos.length===1)throw new Error('seek failed');
      this._time=value;queueMicrotask(()=>{
      // The target frame's actual size differs from the initial metadata.
      this.videoWidth=3840;this.videoHeight=2160;this.readyState=2;
      this.dispatchEvent(new Event('seeked'));
    })}
  }
  const document={createElement(type){
    if(type==='video'){const video=new Video();videos.push(video);return video}
    const canvas={width:0,height:0,getContext(type,options){
      assert.equal(type,'2d');assert.equal(options.colorSpace,'srgb');
      return {drawImage(...args){canvas.draw={args,width:canvas.width,height:canvas.height}}};
    },toBlob(callback,type){
      encoded++;assert.equal(type,'image/png');
      callback(failEncode&&encoded===1?null:new Blob(['original frame'],{type:'image/png'}));
    }};
    images.push(canvas);return canvas;
  }};
  const exported={};let token='account-a';
  vm.runInNewContext(code,{exports:exported,require(name){
    if(name.includes('http'))return {getAccessToken:()=>token,fetchWithAuth:async url=>{fetches.push(url);return {ok:true,blob:async()=>new Blob(['source'])}}};
    if(name.includes('capture-png'))return {encodeCapturePNG};
    return {frameCaptureSeekTarget};
  },Blob,Error,URL:{createObjectURL:()=>`blob:cache-${fetches.length}`,revokeObjectURL:url=>revoked.push(url)},
  AbortController,AbortSignal,document,window:{setTimeout:timeout,clearTimeout:clearTimer},setTimeout:timeout,clearTimeout:clearTimer,
  HTMLMediaElement:{HAVE_CURRENT_DATA:2}});
  return {capture:exported.captureVideoFrame,images,videos,fetches,revoked,timers,setToken:value=>{token=value}};
}

test('target-frame dimensions and PNG survive without card-size resampling',async()=>{
  const env=setup();const result=await env.capture('https://media/original.mp4',2.5);
  assert.equal(result.width,3840);assert.equal(result.height,2160);assert.equal(result.blob.type,'image/png');
  assert.equal(env.images[0].draw.width,3840);assert.equal(env.images[0].draw.height,2160);
  assert.equal(env.images[0].draw.args.length,3,'drawImage has no scaling dimensions');
  assert.equal(env.images[0].width,1);assert.equal(env.images[0].height,1,'drawing buffer released');
  assert.equal(env.videos[0].src,'','decoder released');
});

test('synchronous metadata and seek errors leave no orphan timers and do not poison the queue',async()=>{
  for(const options of [{throwLoad:true},{throwSeek:true}]) {
    const env=setup(options);
    await assert.rejects(env.capture('https://media/source.mp4',1),/视频/);
    assert.deepEqual([...env.timers.values()],[60000],'only the cache expiry remains');
    const next=await env.capture('https://media/source.mp4',2);
    assert.equal(next.width,3840);
    assert.deepEqual([...env.timers.values()],[60000]);
  }
});

test('a decoder cleanup exception cannot discard a successfully encoded PNG',async()=>{
  const env=setup({cleanupThrows:true});
  const frame=await env.capture('https://media/source.mp4',1);
  assert.equal(frame.blob.type,'image/png');
  assert.equal(env.images[0].width,1);
});

test('an encoding failure releases buffers and the next queued capture still succeeds',async()=>{
  const env=setup({failEncode:true});
  const first=env.capture('https://media/same.mp4',0);
  const second=env.capture('https://media/same.mp4',8);
  await assert.rejects(first,/编码失败/);await second;
  assert.equal(env.fetches.length,1,'same original is reused');
  assert.ok(env.videos[1].currentTime>7.99);
  assert.ok(env.images.every(canvas=>canvas.width===1));
  assert.ok(env.videos.every(video=>video.src===''));
});

test('queued different videos revoke the old cache only after its decoder finishes',async()=>{
  const env=setup();await Promise.all([env.capture('https://media/a.mp4',1),env.capture('https://media/b.mp4',2)]);
  assert.equal(env.fetches.length,2);assert.deepEqual(env.revoked,['blob:cache-1']);
  assert.ok(env.videos.every(video=>video.src===''));
});

test('switching accounts never reuses the previous account video blob',async()=>{
  const env=setup();await env.capture('https://media/private.mp4',1);
  env.setToken('account-b');await env.capture('https://media/private.mp4',2);
  assert.equal(env.fetches.length,2);assert.deepEqual(env.revoked,['blob:cache-1']);
});
