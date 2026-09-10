import assert from "node:assert/strict";
import test from "node:test";
import { panoramaCaptureSize } from "./panorama-capture.ts";

test("8K panoramas export near source angular density instead of card resolution", () => {
  const size=panoramaCaptureSize({
    sourceWidth:8192,sourceHeight:4096,
    viewportWidth:608,viewportHeight:304,previewPixelRatio:2,verticalFov:74,
    maxRenderbufferSize:16384,
  });
  assert.ok(size.width > 3800,`width=${size.width}`);
  assert.ok(size.height > 1900,`height=${size.height}`);
  assert.ok(Math.abs(size.width/size.height-2)<0.002);
  assert.ok(size.width<=4096&&size.height<=4096);
  assert.ok(size.width*size.height<=12_000_000);
});

test("small and 4K panoramas export at a 2K long-edge floor instead of being enlarged after capture", () => {
  const size=panoramaCaptureSize({
    sourceWidth:1024,sourceHeight:512,
    viewportWidth:608,viewportHeight:304,previewPixelRatio:2,verticalFov:74,
  });
  assert.deepEqual(size,{width:2560,height:1280});

  const widescreen=panoramaCaptureSize({
    sourceWidth:4096,sourceHeight:2048,
    viewportWidth:608,viewportHeight:342,previewPixelRatio:2,verticalFov:74,
  });
  assert.equal(Math.max(widescreen.width,widescreen.height),2560);
  assert.ok(Math.abs(widescreen.width/widescreen.height-16/9)<0.002);
});

test("capture obeys GPU and pixel memory limits for extreme panoramas", () => {
  const size=panoramaCaptureSize({
    sourceWidth:32768,sourceHeight:16384,
    viewportWidth:1920,viewportHeight:1080,previewPixelRatio:2,verticalFov:100,
    maxRenderbufferSize:2048,
  });
  assert.ok(size.width<=2048&&size.height<=2048);
  assert.ok(size.width*size.height<=12_000_000);
  assert.ok(Math.abs(size.width/size.height-16/9)<0.002);
});
