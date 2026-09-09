import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const api = readFileSync(new URL("./api.ts", import.meta.url), "utf8");
const http = readFileSync(new URL("./http.ts", import.meta.url), "utf8");

test("smart uploads without a progress callback avoid the XHR fallback", () => {
  assert.match(api, /const uploaded = onProgress\s*\? http\.uploadProgress<[\s\S]*?: http\.upload/);
});

test("an ambiguous fallback response recovers the committed file by content hash", () => {
  assert.match(api, /ambiguousUploadResult\(result\)[\s\S]*?fileApi\.presign\(presignInput\)[\s\S]*?existingFile/);
  assert.doesNotMatch(api, /ambiguousUploadResult\(result\)[\s\S]*?uploadProgress<[\s\S]*?uploadProgress</);
});

test("fetch and XHR uploads share actionable non-JSON response formatting", () => {
  assert.match(http, /fetchUploadResult<[\s\S]*?parseUploadResponse<T>/);
  assert.match(http, /xhr\.onload = \(\) => \{\s*resolve\(parseUploadResponse<T>/);
  assert.doesNotMatch(http, /message: "上传响应解析失败"/);
});
