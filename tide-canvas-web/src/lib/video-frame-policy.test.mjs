import assert from "node:assert/strict";
import test from "node:test";

import { frameCaptureSeekTarget } from "./video-frame-policy.ts";

test("an unplayed video seeks just past zero so the first frame is decoded", () => {
  assert.equal(frameCaptureSeekTarget(0, 8), 0.001);
  assert.equal(frameCaptureSeekTarget(Number.NaN, 8), 0.001);
});

test("capture time stays bounded to decodable video frames", () => {
  assert.equal(frameCaptureSeekTarget(3.5, 8), 3.5);
  assert.equal(frameCaptureSeekTarget(8, 8), 7.98);
  assert.equal(frameCaptureSeekTarget(0, 0.0004), 0.0002);
});
