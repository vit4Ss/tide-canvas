import assert from "node:assert/strict";
import test from "node:test";
import { buildGenerationInput, validateReferences, resultUrls, estimatedCost } from "../src/lib/studio.ts";
import { ENDPOINTS, requestPath, requestTemplate, parseRequestBody, curlExample } from "../src/lib/developer.ts";
import { englishError } from "../src/lib/english.ts";
import { isEnglishPlan, planPurchase } from "../src/lib/billing.ts";

const model = { id: "9007199254740993", modelKey: "rh-upscale", type: "upscale", name: "RH", pointCost: "2", config: {} };
const settings = { media: "image", mode: "text_to_image", prompt: "A scene", resolution: "4k", ratio: "16:9", quality: "high", duration: "5s", count: 2, refs: [], outputFps: "2x", upscaleModel: "max", voice: "", lyrics: "", instrumental: false, enablePbr: false };
test("RH enhancement requests contain the source and options, never a prompt", () => {
  const input = buildGenerationInput({ ...settings, media: "upscale", refs: [{ url: "https://storage.example/source.mp4", kind: "video", name: "source" }] }, model);
  assert.deepEqual(input, { videoUrl: "https://storage.example/source.mp4", targetResolution: "4k", outputFps: "2x", upscaleModel: "max" });
});
test("other upscalers do not inherit RH-specific options", () => {
  const input = buildGenerationInput({ ...settings, media: "upscale", refs: [{ url: "https://storage.example/source.mp4", kind: "video", name: "source" }] }, { ...model, modelKey: "wavespeed-ai/video-upscaler" });
  assert.equal("outputFps" in input, false); assert.equal("upscaleModel" in input, false);
});
test("first and last frame mode requires exactly two images", () => {
  const frame = { url: "https://storage.example/frame.jpg", kind: "image", name: "frame" };
  assert.match(validateReferences({ ...settings, mode: "start_end_to_video", refs: [frame] }, model), /first frame/);
  assert.equal(validateReferences({ ...settings, mode: "start_end_to_video", refs: [frame, frame] }, model), "");
});
test("references are not silently ignored in text-only modes", () => {
  assert.match(validateReferences({ ...settings, refs: [{ url: "https://storage.example/a.jpg", kind: "image", name: "a" }] }, model), /reference-supported/);
});
test("reference video input keeps each media category separate", () => {
  const refs = ["image", "video", "audio"].map((kind) => ({ kind, name: kind, url: `https://storage.example/${kind}` }));
  const input = buildGenerationInput({ ...settings, media: "video", mode: "reference_to_video", refs }, model);
  assert.deepEqual(input.imageList, ["https://storage.example/image"]); assert.deepEqual(input.videoReferences, ["https://storage.example/video"]); assert.deepEqual(input.audioReferences, ["https://storage.example/audio"]); assert.equal(input.duration, 5);
});
test("disabled batch controls do not send a hidden count", () => {
  const input = buildGenerationInput(settings, { ...model, type: "image", config: { hideBatchCount: true } });
  assert.equal("batchCount" in input, false);
});
test("generation estimates follow configured quality and resolution", () => {
  assert.equal(estimatedCost({ ...model, type: "image", config: { priceMatrix: { high: { "4k": 7 } } } }, settings), 14);
});
test("result previews reject executable and data URLs", () => {
  assert.deepEqual(resultUrls({ urls: ["javascript:alert(1)", "data:text/html,hello", "https://storage.example/a.png"] }, "https://storage.example/a.png"), ["https://storage.example/a.png"]);
});
test("task identifiers retain string precision", () => {
  assert.equal(requestPath("task", "9007199254740993123"), "/api/en/open/v1/tasks/9007199254740993123");
});
test("task lookup without an ID cannot call an invented endpoint", () => assert.throws(() => requestPath("task", ""), /task ID/));
test("playground builds a compatible handler for every media type", () => {
  for (const [type, handler] of [["image", "text_to_image"], ["video", "text_to_video"], ["audio", "text_to_audio"], ["3d", "generate_3d"], ["upscale", "video_upscale"]]) assert.equal(requestTemplate("generate", "a-model", type).handler, handler);
  assert.equal("prompt" in requestTemplate("generate", "rh-upscale", "upscale").input, false);
});
test("developer namespaces match the shared service routes", () => {
  assert.equal(ENDPOINTS.generate.path, "/api/en/open/v1/generations");
  assert.deepEqual(Object.keys(ENDPOINTS), ["models", "generate", "task"]);
});
test("request bodies must be valid JSON objects", () => {
  for (const body of ["null", "[]", "broken", '"hello"']) assert.throws(() => parseRequestBody(body));
  assert.deepEqual(parseRequestBody('{"modelId":"test"}'), { modelId: "test" });
});
test("copied cURL escapes shell quotes and uses an environment variable", () => {
  const curl = curlExample("https://example.com", "POST", "/api/en/open/v1/generations", JSON.stringify({ prompt: "a creator's idea $(do-not-execute)" }));
  assert.match(curl, /FRAMELYN_API_KEY/); assert.match(curl, /creator'\\''s/);
});
test("annual billing is a full annual payment with twelve credit allowances", () => {
  assert.deepEqual(planPurchase({ monthly: 29, yearly: 240, monthlyPoints: 1000 }, "yearly"), { monthlyEquivalent: 20, total: 240, credits: 12000, available: true });
});
test("annual promotions follow the authoritative annual total", () => {
  assert.equal(planPurchase({ monthly: 29, yearly: 240, monthlyPoints: 1000, promo: { yearly: 180 } }, "yearly").total, 180);
});
test("missing annual prices are not advertised as a free upgrade", () => assert.equal(planPurchase({ monthly: 29, yearly: 0, monthlyPoints: 1000 }, "yearly").available, false));
test("legacy errors become actionable English messages", () => {
  assert.match(englishError("积分不足"), /enough credits/);
  assert.match(englishError("任务提交结果尚未确认"), /before submitting again/);
  assert.equal(/[\p{Script=Han}]/u.test(englishError("其他中文错误")), false);
});

test("English billing requires an explicit USD catalog and keeps annual totals exact", () => {
  assert.equal(isEnglishPlan({ market: "cn", currency: "CNY" }), false);
  assert.equal(isEnglishPlan({}), false);
  assert.equal(isEnglishPlan({ market: "en", currency: "USD" }), true);
  const purchase = planPurchase({ monthly: 12, yearly: 100, monthlyPoints: 600 }, "yearly");
  assert.equal(purchase.total, 100);
  assert.equal(purchase.credits, 7200);
  assert.equal(planPurchase({ monthly: 0, yearly: 0, monthlyPoints: 60 }, "yearly").credits, 60);
});
