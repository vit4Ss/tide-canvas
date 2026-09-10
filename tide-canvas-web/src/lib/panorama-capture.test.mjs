import assert from "node:assert/strict";
import test from "node:test";
import { MAX_PANORAMA_OUTPUT_PIXELS as CAPTURE_PIXEL_LIMIT, panoramaCaptureSize } from "./panorama-capture.ts";
import { MAX_PANORAMA_OUTPUT_PIXELS as PROJECTION_PIXEL_LIMIT } from "./panorama-projection.ts";

test("size selection and projection enforce the same output pixel ceiling", () => {
  assert.equal(CAPTURE_PIXEL_LIMIT, PROJECTION_PIXEL_LIMIT);
});

test("8K panoramas export near source angular density instead of card resolution", () => {
  const size=panoramaCaptureSize({
    sourceWidth:8192,sourceHeight:4096,
    viewportWidth:608,viewportHeight:304,previewPixelRatio:2,verticalFov:74,
    maxRenderbufferSize:16384,
  });
  assert.ok(size.width > 3800,`width=${size.width}`);
  assert.ok(size.height > 1900,`height=${size.height}`);
  assert.ok(Math.abs(size.width/size.height-2)<0.002);
  assert.ok(size.width<=8192&&size.height<=8192);
  assert.ok(size.width*size.height<=24_000_000);
});

test("large supported source density is preserved beyond 4K with bounded output memory", () => {
  const size = panoramaCaptureSize({ sourceWidth:11000,sourceHeight:5500,
    viewportWidth:640,viewportHeight:360,previewPixelRatio:1,verticalFov:74 });
  assert.ok(size.width > 4600);
  assert.ok(size.width * size.height <= 24_000_000);
  assert.ok(size.width <= 8192);
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
