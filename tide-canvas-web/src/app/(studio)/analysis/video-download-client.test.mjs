import assert from "node:assert/strict";
import test from "node:test";
import { receiveVideoDownload } from "./video-download-client.ts";

const mp4 = () => new Blob([new Uint8Array([0, 0, 0, 12, 102, 116, 121, 112, 105, 115, 111, 109])], { type: "video/mp4" });
class Request {
  headers = {};
  sent = false;
  aborted = false;
  open(method, url) { this.method = method; this.url = url; }
  setRequestHeader() {}
  getResponseHeader(name) { return this.headers[name] ?? null; }
  send() { this.sent = true; }
  abort() { this.aborted = true; this.onabort?.(); }
  respond(status, blob, contentType, length = blob.size) {
    this.status = status;
    this.response = blob;
    this.headers = { "Content-Type": contentType, "Content-Length": String(length) };
    this.readyState = 2;
    this.onreadystatechange?.();
    if (!this.aborted) { this.readyState = 4; this.onload?.(); }
  }
}
function setup(limit = 1000, signal = new AbortController().signal) {
  const xhr = new Request();
  const progress = [];
  const promise = receiveVideoDownload("https://site.example/api/download?signed=1", limit, signal, (value) => progress.push(value), () => xhr);
  return { xhr, promise, progress };
}

test("HTTP 200 business errors are shown instead of being saved as MP4", async () => {
  const { xhr, promise } = setup();
  xhr.respond(200, new Blob([JSON.stringify({ success: false, message: "视频平台拒绝了下载请求" })]), "application/json");
  await assert.rejects(promise, /视频平台拒绝了下载请求/);
});

test("gateway HTML and expired tickets never become downloaded video files", async () => {
  const gateway = setup();
  gateway.xhr.respond(504, new Blob(["<html>timeout</html>"]), "text/html");
  await assert.rejects(gateway.promise, /HTTP 504/);
  const expired = setup();
  expired.xhr.respond(401, new Blob(['{"message":"下载地址无效或已过期"}']), "application/json");
  await assert.rejects(expired.promise, /下载地址无效或已过期/);
});

test("only a received MP4 is handed back, with measured progress", async () => {
  const { xhr, promise, progress } = setup();
  assert.equal(xhr.responseType, "blob");
  assert.equal(xhr.sent, true);
  assert.equal(xhr.method, "GET");
  xhr.onprogress({ loaded: 6, total: 12, lengthComputable: true });
  const video = mp4();
  xhr.respond(200, video, "video/mp4");
  assert.equal(await promise, video);
  assert.deepEqual(progress, [{ loaded: 6, total: 12 }]);
});

test("unknown length does not invent a percentage, and false MP4/empty files fail", async () => {
  const result = setup();
  result.xhr.onprogress({ loaded: 5, total: 0, lengthComputable: false });
  result.xhr.respond(200, new Blob(["not an MP4 file"]), "video/mp4");
  await assert.rejects(result.promise, /没有返回有效的 MP4/);
  assert.deepEqual(result.progress, [{ loaded: 5, total: 0 }]);
  const empty = setup();
  empty.xhr.respond(200, new Blob([]), "video/mp4");
  await assert.rejects(empty.promise, /空文件/);
});

test("oversized declared and streamed bodies are aborted", async () => {
  const declared = setup(10);
  declared.xhr.respond(200, mp4(), "video/mp4");
  await assert.rejects(declared.promise, /大小上限/);
  assert.equal(declared.xhr.aborted, true);
  const streamed = setup(10);
  streamed.xhr.onprogress({ loaded: 11, total: 0, lengthComputable: false });
  await assert.rejects(streamed.promise, /大小上限/);
  assert.equal(streamed.xhr.aborted, true);
});

test("cancellation stops the request and prevents a late response from succeeding", async () => {
  const controller = new AbortController();
  const pending = setup(1000, controller.signal);
  controller.abort();
  await assert.rejects(pending.promise, { name: "AbortError" });
  assert.equal(pending.xhr.aborted, true);
  assert.equal(pending.xhr.onload, null);
  const before = setup(1000, controller.signal);
  await assert.rejects(before.promise, { name: "AbortError" });
  assert.equal(before.xhr.sent, false);
});

test("network errors and timeouts are surfaced instead of indefinite preparing", async () => {
  const network = setup();
  network.xhr.onerror();
  await assert.rejects(network.promise, /连接失败/);
  const timeout = setup();
  timeout.xhr.ontimeout();
  await assert.rejects(timeout.promise, /下载超时/);
});
