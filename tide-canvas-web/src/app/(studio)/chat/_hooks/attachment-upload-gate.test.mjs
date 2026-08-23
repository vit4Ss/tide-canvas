import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");
const references = read("./use-references.ts");
const send = read("./use-send-message.ts");
const composer = read("../_components/composer.tsx");
const thumb = read("../_components/ref-thumb.tsx");
const config = read("./use-composer-config.ts");

test("same-tick file selection is visible to send before React rerenders", () => {
  assert.match(references, /refsRef\.current = next;[\s\S]*setRefs\(next\)/);
  assert.match(references, /pendingUploadsRef\.current\.set\(item\.key, task\)/);
  assert.match(references, /getLatestRefs/);
  assert.match(send, /selectAllowedRefs\(getLatestRefs\(\)\)/);
});

test("send waits for attached uploads and fails closed when one fails", () => {
  const latest = send.indexOf("selectAllowedRefs(getLatestRefs())");
  const wait = send.indexOf("await waitForCurrentUploads", latest);
  const failed = send.indexOf("allowedRefs.some((r) => r.failed)", wait);
  const payload = send.indexOf("const attachSnapshot", failed);
  assert.ok(latest >= 0 && wait > latest && failed > wait && payload > failed);
  assert.match(send, /文件仍在上传，上传完成后将自动发送/);
  assert.match(send, /有文件上传失败，请移除后重试/);
  assert.match(references, /removalWaitersRef/);
  assert.match(references, /for \(const release of waiters\) release\(\)/);
});

test("composer exposes per-file and aggregate upload progress", () => {
  assert.match(references, /uploadFileSmart\(file, \(value\) =>/);
  assert.match(thumb, /ref-progress-bar/);
  assert.match(composer, /正在上传 \{uploadingRefs\.length\} 个文件/);
  assert.match(composer, /现在发送会等待上传完成/);
});

test("text documents keep their original name and enforce the relay size limit", () => {
  assert.match(send, /name: r\.name/);
  assert.match(config, /maxSizeByKind: \{ file: 15 \}/);
});
