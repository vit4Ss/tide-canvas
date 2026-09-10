import assert from "node:assert/strict";
import test from "node:test";
import { encodeCapturePNG } from "./capture-png.ts";

test("capture encoding preserves the PNG bytes and requests no lossy quality", async () => {
  const png=new Blob(['png'],{type:'image/png'});
  const result=await encodeCapturePNG({toBlob(callback,...args){assert.deepEqual(args,['image/png']);callback(png)}});
  assert.equal(result,png);
});
test("null, wrong format and synchronous browser errors reject", async () => {
  await assert.rejects(encodeCapturePNG({toBlob:fn=>fn(null)}),/编码失败/);
  await assert.rejects(encodeCapturePNG({toBlob:fn=>fn(new Blob(['jpeg'],{type:'image/jpeg'}))}),/编码失败/);
  await assert.rejects(encodeCapturePNG({toBlob(){throw new Error('tainted')}}),/tainted/);
});
test("a missing callback times out; a late callback cannot complete the failed capture", async (t) => {
  t.mock.timers.enable({apis:['setTimeout']});
  let callback;
  const result=encodeCapturePNG({toBlob:fn=>{callback=fn}},30000);
  const failure=assert.rejects(result,/编码超时/);
  t.mock.timers.tick(30000);
  await failure;
  callback(new Blob(['late'],{type:'image/png'}));
});
