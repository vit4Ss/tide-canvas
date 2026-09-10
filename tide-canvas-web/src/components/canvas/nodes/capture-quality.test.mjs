import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const panorama=readFileSync(new URL("./inline-panorama.tsx",import.meta.url),"utf8");
const imageNode=readFileSync(new URL("./image-node.tsx",import.meta.url),"utf8");
const videoNode=readFileSync(new URL("./video-node.tsx",import.meta.url),"utf8");

test("panorama capture renders at source-aware resolution and streams four views",()=>{
  assert.match(panorama,/setLoading\(true\);\s*setError\(null\);/);
  assert.match(panorama,/panoramaCaptureSize\(\{/);
  assert.match(panorama,/const geometry = new THREE\.SphereGeometry\(500, 60, 40\)/);
  assert.match(panorama,/captureGeometry = new THREE\.SphereGeometry\(500, 256, 128\)/);
  assert.match(panorama,/panoramaMesh\.geometry = denseCaptureGeometry\(\)[\s\S]*?renderer\.render\(scene, camera\)[\s\S]*?panoramaMesh\.geometry = geometry/);
  assert.match(panorama,/geometry\.dispose\(\); captureGeometry\?\.dispose\(\)/);
  assert.match(panorama,/renderer\.setPixelRatio\(1\)[\s\S]*?renderer\.setSize\(size\.width, size\.height, false\)/);
  assert.match(panorama,/CAPTURE_ENCODE_TIMEOUT_MS = 30_000/);
  assert.match(panorama,/TEXTURE_DECODE_TIMEOUT_MS = 30_000/);
  assert.match(panorama,/if \(settled\) \{ loaded\.dispose\(\); return; \}/);
  assert.match(panorama,/if \(pendingBlobURL\) \{ URL\.revokeObjectURL\(pendingBlobURL\)/);
  assert.match(panorama,/capture4: async \(consume\)[\s\S]*?await consume\(frame, index\)/);
  assert.doesNotMatch(panorama,/toDataURL\("image\/png"\)/);
  assert.match(imageNode,/await panoApiRef\.current\?\.capture\(\)/);
  assert.match(imageNode,/panoCaptureLockRef\.current = true/);
  assert.match(imageNode,/new File\(\[captured\.blob\], "全景截图\.png"/);
  assert.doesNotMatch(imageNode,/fetch\(dataUrl\)/);
});

test("video screenshot uses the shared original-resolution lossless frame capture",()=>{
  assert.match(videoNode,/captureVideoFrame\(objUrlRef\.current \|\| node\.videoSrc, time\)/);
  assert.match(videoNode,/captureLockRef\.current = true/);
  assert.match(videoNode,/new File\(\[captured\.blob\],[\s\S]*?image\/png/);
  assert.match(videoNode,/const vw = captured\.width[\s\S]*?const vh = captured\.height/);
  assert.doesNotMatch(videoNode,/function grabFrame\(/);
});
