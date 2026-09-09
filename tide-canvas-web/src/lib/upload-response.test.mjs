import assert from "node:assert/strict";
import test from "node:test";
import { parseUploadResponse } from "./upload-response.ts";

test("upload responses preserve the normal Result envelope", () => {
  const result = parseUploadResponse(200, '{"success":true,"code":200,"data":{"id":"1"}}');
  assert.equal(result.success, true);
  assert.deepEqual(result.data, { id: "1" });
});

test("proxy HTML and empty responses become actionable upload errors", () => {
  assert.match(parseUploadResponse(413, "<html>too large</html>").message, /HTTP 413/);
  assert.match(parseUploadResponse(502, "").message, /HTTP 502/);
  assert.match(parseUploadResponse(200, "not json").message, /无法识别.*HTTP 200/);
  assert.equal(parseUploadResponse(0, "").code, 0);
});

test("common gateway JSON errors keep their useful message", () => {
  assert.equal(parseUploadResponse(400, '{"error":"invalid multipart body"}').message, "invalid multipart body");
});
