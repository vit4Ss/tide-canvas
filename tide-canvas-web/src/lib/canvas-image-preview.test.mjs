import assert from 'node:assert/strict';
import test from 'node:test';
import {canvasImagePreview} from './canvas-image-preview.ts';
const image={original:'https://cdn/original.png',thumbnail:'https://cdn/preview.webp',preferOriginal:true,failedUrls:[]};

test('focused cards prefer original, overview and multi-selection prefer thumbnails',()=>{
  assert.equal(canvasImagePreview(image),image.original);
  assert.equal(canvasImagePreview({...image,preferOriginal:false}),image.thumbnail);
});
test('original failure keeps a working thumbnail; thumbnail failure still tries original',()=>{
  assert.equal(canvasImagePreview({...image,failedUrls:[image.original]}),image.thumbnail);
  assert.equal(canvasImagePreview({...image,preferOriginal:false,failedUrls:[image.thumbnail]}),image.original);
  assert.equal(canvasImagePreview({...image,failedUrls:[image.original,image.thumbnail]}),undefined);
});
test('unprocessed URLs have only one attempt and explicit retry restores the original',()=>{
  assert.equal(canvasImagePreview({...image,thumbnail:image.original,failedUrls:[image.original]}),undefined);
  assert.equal(canvasImagePreview({...image,failedUrls:[]}),image.original);
});
