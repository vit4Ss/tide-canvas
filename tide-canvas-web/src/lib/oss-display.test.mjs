import assert from "node:assert/strict";
import test from "node:test";
import {
  disableOssDisplayProcessing,
  fallbackOssDisplayImage,
  ossDisplayUrl,
  restoreOssDisplayImage,
} from "./oss-display.ts";

test("an OSS source that rejects image processing uses its original URL afterwards", () => {
  const source = "https://cdn.mbfczzzz.top/canvas/uploads/gen/oversized.png";
  assert.equal(
    ossDisplayUrl(source, 1280),
    `${source}?x-oss-process=image/resize,w_1280,m_lfit`,
  );
  disableOssDisplayProcessing(source);
  assert.equal(ossDisplayUrl(source, 1280), source);
});

test("test CDN thumbnails use the same safe OSS downsampling path", () => {
  const source = "https://test-cdn.mbfczzzz.top/canvas/uploads/gen/reference.png";
  assert.equal(
    ossDisplayUrl(source, 160),
    `${source}?x-oss-process=image/resize,w_160,m_lfit`,
  );
});

test("image recovery tries the original once and clears stale failure styles after a later load", () => {
  const source = "https://cdn.mbfczzzz.top/canvas/uploads/gen/recover.png";
  const image = {
    dataset: {},
    style: { visibility: "" },
    current: `${source}?x-oss-process=image/resize,w_640,m_lfit`,
    getAttribute(name) {
      return name === "src" ? this.current : null;
    },
    get src() {
      return this.current;
    },
    set src(value) {
      this.current = value;
    },
  };

  assert.equal(fallbackOssDisplayImage(image, source), true);
  assert.equal(image.src, source);
  assert.equal(image.dataset.ossOriginalFallback, "1");
  assert.equal(fallbackOssDisplayImage(image, source), false);
  assert.equal(image.style.visibility, "hidden");

  restoreOssDisplayImage(image);
  assert.equal(image.style.visibility, "");
  assert.equal(image.dataset.ossOriginalFallback, undefined);
});
