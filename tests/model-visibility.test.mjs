import assert from "node:assert/strict";
import test from "node:test";
import { isMediaModel, isTextTask } from "../src/lib/model-visibility.ts";
import { mediaHistoryPage } from "../src/lib/media-history.ts";

test("Framelyn offers only the five media model types, including GPT image models", () => {
  const models = [{ name: "GPT Image", type: "image" }, { type: "video" }, { type: "audio" }, { type: "3d" }, { type: "upscale" }, { name: "GPT text", type: "text" }, { name: "DeepSeek", type: "text" }, {}, { type: "unknown" }];
  assert.equal(models.filter(isMediaModel).length, 5);
  assert.equal(isTextTask({ handler: "assistant_chat" }), true);
  assert.equal(isTextTask({ handler: "skill_text_completion" }), true);
  assert.equal(isTextTask({ handler: "text_to_image" }), false);
});

const row = (id, seconds) => ({ id, createTime: new Date(Date.UTC(2026, 9, 12, 0, 0, seconds)).toISOString() });
const feeds = { image: [row("90", 90), row("80", 80), row("70", 70), row("60", 60), row("30", 30)], video: [row("85", 85), row("50", 50)], audio: [row("40", 40)], "3d": [row("20", 20)] };
const result = (records, total) => ({ success: true, code: 200, message: "", timestamp: 0, data: { records, total } });
function getter(requests) {
  return async (path, signal) => {
    assert.equal(signal.aborted, false);
    const params = new URL(path, "http://fixture").searchParams;
    requests.push(params);
    const source = feeds[params.get("mediaType")];
    assert.ok(source, "Every request is filtered before backend pagination");
    const size = Number(params.get("pageSize"));
    const start = (Number(params.get("pageNum")) - 1) * size;
    return result(source.slice(start, start + size), source.length);
  };
}

test("all-media history merges before paging, keeps complete pages and excludes text from totals", async () => {
  const requests = [];
  const first = await mediaHistoryPage("/api/ai/tasks?pageNum=1&pageSize=3&status=1", new AbortController().signal, getter(requests));
  const second = await mediaHistoryPage("/api/ai/tasks?pageNum=2&pageSize=3&status=1", new AbortController().signal, getter(requests));
  assert.deepEqual(first.data.records.map((item) => item.id), ["90", "85", "80"]);
  assert.deepEqual(second.data.records.map((item) => item.id), ["70", "60", "50"]);
  assert.equal(second.data.total, 9);
  assert.equal(second.data.pages, 3);
  assert.equal(requests.some((params) => params.get("mediaType") === "upscale"), false, "Video enhancement must not be counted twice");
  assert.equal(requests.every((params) => params.get("status") === "1"), true);
});

test("the final media page preserves the search and outcome filters", async () => {
  const requests = [];
  const page = await mediaHistoryPage("/api/ai/history?pageNum=3&pageSize=4&keyword=coast&success=1", new AbortController().signal, getter(requests));
  assert.deepEqual(page.data.records.map((item) => item.id), ["20"]);
  assert.equal(page.data.total, 9);
  assert.ok(requests.every((params) => params.get("keyword") === "coast" && params.get("success") === "1"));
});

test("single-format history uses its original page and does not fetch the other formats", async () => {
  const requests = [];
  await mediaHistoryPage("/api/ai/history?pageNum=2&pageSize=2&mediaType=image", new AbortController().signal, getter(requests));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].get("pageNum"), "2");
});

test("text history cannot be requested through the media-only loader", async () => {
  const page = await mediaHistoryPage("/api/ai/tasks?mediaType=text", new AbortController().signal, () => { throw new Error("Must not fetch text history"); });
  assert.deepEqual(page.data.records, []);
  assert.equal(page.data.total, 0);
});

test("partial feed failures never masquerade as a complete media list", async () => {
  const failure = { success: false, code: 503, message: "Try again", data: null, timestamp: 0 };
  const page = await mediaHistoryPage("/api/ai/tasks", new AbortController().signal, async (path) => path.includes("mediaType=video") ? failure : result([], 0));
  assert.equal(page, failure);
});

test("account changes abort further pagination and discard the result", async () => {
  const controller = new AbortController();
  let requests = 0;
  const page = await mediaHistoryPage("/api/ai/tasks?pageNum=2&pageSize=1", controller.signal, async () => {
    requests++;
    if (requests === 4) controller.abort();
    return result([row(String(requests), requests)], 5);
  });
  assert.equal(requests, 4);
  assert.equal(page.success, false);
  assert.equal(page.data, null);
});
