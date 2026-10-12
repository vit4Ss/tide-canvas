import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { taskMedia } from "../src/lib/media.ts";
import { checkSelects, chooseSelect } from "./select-checks.mjs";

const base = process.env.FRONTEND_TEST_URL || "http://localhost:3100";
const root = process.cwd();
const artifacts = path.join(root, ".impeccable", "review");
await mkdir(artifacts, { recursive: true });
const executablePath = process.env.BROWSER_PATH || (process.platform === "win32" ? "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" : undefined);
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : { channel: "chrome" }) });
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
const page = await context.newPage();
const errors = []; const requests = []; const tasks = new Map(); const polls = new Map(); const orders = [];
page.on("pageerror", (error) => errors.push(error.message));
tasks.set("hidden-text-task", { id: "hidden-text-task", handler: "assistant_chat", modelName: "Hidden Text Model", status: 1, pointCost: 7, resultUrl: "", resultMeta: { text: "Hidden text result" }, input: { prompt: "Hidden text prompt" }, createTime: "2026-10-12T09:00:00Z" });
let key = { name: "Account key", hint: "key_••••demo", enabled: true, revision: 1, createTime: "2026-10-12T08:00:00Z", updateTime: "2026-10-12T08:00:00Z" };
const user = { id: "90071992547409930", username: "alex", email: "alex@example.com", nickname: "Alex", avatar: "", role: 0, vipLevel: 0, points: 1200, storageQuota: 1073741824, createTime: "2026-10-12T08:00:00Z" };
const models = [
  { id: "hidden-text-row", modelKey: "hidden-text-model", name: "Hidden Text Model", type: "text", pointCost: "2", config: {} },
  { id: "image-row", modelKey: "image-model", name: "Image model", type: "image", desc: "A model for your next visual idea.", pointCost: "4", config: { modes: ["t2i", "i2i"], ratios: ["1:1", "16:9"], resolutions: ["1k", "4k"], qualities: ["high", "medium"], batchOptions: [1, 2, 4], priceMatrix: { high: { "1k": 4, "4k": 12 } } } },
  { id: "video-row", modelKey: "video-model", name: "Video model", type: "video", desc: "Bring the scene to life.", pointCost: "8", config: { modes: ["t2v", "i2v", "keyframe", "omni_ref"], resolutions: ["720p", "1080p"], ratios: ["16:9", "9:16"], durations: ["5s", "10s"], priceMatrix: { "5s": { "720p": 8, "1080p": 12 } }, referenceVideoBillingEnabled: true } },
  { id: "rh-row", modelKey: "rh-upscale", name: "RH Upscale", type: "upscale", pointCost: "0", config: { resolutions: ["720p", "1080p", "2k", "4k"], pricePerSecondByUpscaleModel: { max: 7, high: 6, medium: 5, low: 4 } } },
  { id: "audio-row", modelKey: "audio-model", name: "Audio model", type: "audio", pointCost: "3", config: {} },
  { id: "3d-row", modelKey: "3d-model", name: "3D model", type: "3d", pointCost: "10", config: {} },
];
const rawPlans = [{ id: "essential", name: "Essential", desc: "A thoughtful place to start.", monthly: 29, yearly: 20, monthlyPoints: 1000, featured: false, vipLevel: 1, items: ["Use available models", "Keep your results", "Studio and API access"] }, { id: "creator", name: "Creator", desc: "For a more active creative practice.", monthly: 79, yearly: 60, monthlyPoints: 4000, featured: true, vipLevel: 2, items: ["More credits for your ideas", "Manage your creations", "Studio and API access"] }, { id: "studio", name: "Studio", desc: "More room for larger ideas.", monthly: 159, yearly: 120, monthlyPoints: 10000, featured: false, vipLevel: 3, items: ["A larger credit allowance", "Manage your creative assets", "Track every request"] }];
const plans = rawPlans.map((plan) => ({ ...plan, market: "en", currency: "USD", yearly: plan.yearly * 12 }));
const files = [{ id: "file-1", originalName: "coast.jpg", fileUrl: `${base}/art/coast.jpg`, fileType: "image", fileSize: 175738, mimeType: "image/jpeg", category: "image", createTime: "2026-10-12T08:00:00Z" }];
const paged = (records) => ({ records, total: records.length, pageNum: 1, pageSize: 24, pages: 1 });
const mockApi = async (route) => {
  const request = route.request(); const url = new URL(request.url()); const pathname = url.pathname;
  let body = null; try { body = request.postDataJSON(); } catch { /* Multipart uploads have no JSON body. */ }
  requests.push({ path: pathname, method: request.method(), body });
  let data = null;
  if (pathname === "/api/auth/me") data = user;
  else if (pathname === "/api/auth/register-config") data = { registerClosed: false };
  else if (pathname === "/api/auth/google/challenge") { await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ success: false, code: 503, message: "Google sign-in is temporarily unavailable. Use your password or try again later.", data: null, timestamp: Date.now() }) }); return; }
  else if (pathname === "/api/auth/login" || pathname === "/api/auth/register-local" || pathname === "/api/auth/refresh") data = { accessToken: "qa-access-token", refreshToken: "qa-refresh-token", userInfo: user, expiresIn: 3600 };
  else if (pathname === "/api/auth/api-key") data = key;
  else if (pathname === "/api/auth/api-key/reveal") data = { key: "qa-example-api-key", revision: key.revision };
  else if (pathname === "/api/auth/api-key/rotate") { key = { ...key, revision: key.revision + 1 }; data = key; }
  else if (pathname === "/api/auth/api-key/status") { key = { ...key, revision: key.revision + 1, enabled: body.enabled }; data = key; }
  else if (pathname === "/api/auth/profile") data = { ...user, nickname: body.nickname };
  else if (pathname === "/api/market/studio-models") data = models.filter((model) => !url.searchParams.get("type") || model.type === url.searchParams.get("type"));
  else if (pathname === "/api/ai/optimize-cost") data = { cost: 1 };
  else if (pathname === "/api/ai/optimize-prompt") data = { prompt: `A refined cinematic interpretation: ${body.prompt}` };
  else if (pathname === "/api/ai/tasks") data = paged([...tasks.values()].filter((task) => (!url.searchParams.get("status") || task.status === Number(url.searchParams.get("status"))) && (!url.searchParams.get("mediaType") || taskMedia(task).kind === url.searchParams.get("mediaType"))));
  else if (pathname === "/api/ai/generate" || pathname === "/api/open/v1/generations") {
    const previous = [...tasks.values()].find((task) => task.clientRequestId === body.clientRequestId);
    const id = previous?.id || String(90071992547410000n + BigInt(tasks.size));
    data = previous || { id, handler: body.handler, modelId: body.modelId, modelName: models.find((model) => model.modelKey === body.modelId)?.name || "AI model", status: 0, progress: 10, pointCost: body.input.batchCount ? 4 * body.input.batchCount : 4, input: body.input, createTime: new Date().toISOString(), resultUrl: "", resultMeta: {}, clientRequestId: body.clientRequestId };
    tasks.set(id, data);
  } else if (/^\/api\/(?:ai|open\/v1)\/tasks\//.test(pathname)) {
    const id = pathname.split("/").at(-1); const current = tasks.get(id);
    if (!current) data = { id, status: 2, handler: "text_to_image", errorMsg: "Task not found" };
    else { const count = (polls.get(id) || 0) + 1; polls.set(id, count); data = { ...current, status: count > 1 ? 1 : 0, progress: count > 1 ? 100 : 40, resultUrl: count > 1 ? `${base}/art/architecture.jpg` : "" }; tasks.set(id, data); }
  } else if (pathname === "/api/ai/upscale-quote") data = { durationSeconds: 4, billedSeconds: 5, ratePerSecond: 7, pointCost: 35, resolution: body.targetResolution, upscaleModel: body.upscaleModel };
  else if (pathname === "/api/ai/reference-video-quote") data = { billingEnabled: true, videoCount: body.videoUrls.length, durationSeconds: 5, pointCost: 5, resolution: body.resolution };
  else if (pathname === "/api/files/presign") data = { existingFile: { ...files[0], originalName: body.filename, fileType: body.contentType.startsWith("video/") ? "video" : "image", fileUrl: body.contentType.startsWith("video/") ? `${base}/qa-video.mp4` : files[0].fileUrl } };
  else if (pathname === "/api/files") data = paged(files);
  else if (pathname === "/api/points/balance") data = { points: 1200, frozen: 0 };
  else if (pathname === "/api/points/records") data = paged([{ id: "credit-1", changeType: "consume", amount: -8, balance: 1200, remark: "Image creation", createTime: "2026-10-12T08:00:00Z" }]);
  else if (pathname === "/api/chat-gateway/usage") data = { ...paged([]), summary: { calls: 0, points: "0", inputTokens: 0, outputTokens: 0, pending: 0 } };
  else if (pathname === "/api/ai/history") data = paged([...tasks.values()].map((task) => ({ id: task.id, mediaType: taskMedia(task).kind, model: task.modelName, prompt: task.input.prompt || "", success: task.status === 1 ? 1 : 0, pointCost: task.pointCost, createTime: task.createTime, durationMs: 1000, isApiCall: false })).filter((row) => !url.searchParams.get("mediaType") || row.mediaType === url.searchParams.get("mediaType")));
  else if (pathname === "/api/billing/en/plans") data = plans;
  else if (pathname === "/api/billing/en/channels") data = [{ key: "usd-test", name: "Test USD checkout", currency: "USD" }];
  else if (pathname === "/api/billing/en/faq") data = { items: [] };
  else if (pathname === "/api/billing/en/compare") data = { rows: [] };
  else if (pathname === "/api/billing/en/promo") data = { enabled: false };
  else if (pathname === "/api/en/orders" && request.method() === "POST") { const plan = plans.find((plan) => plan.id === body.planId); data = { id: "order-1", orderNo: "TEST-ORDER-1", cycle: body.cycle, type: "plan", currency: "USD", market: "en", amount: body.cycle === "yearly" ? plan.yearly : plan.monthly, status: 0, createTime: new Date().toISOString(), payUrl: "https://checkout.example.test/qa-only" }; orders.push(data); }
  else if (pathname === "/api/orders") data = paged(orders);
  else if (pathname.startsWith("/api/orders/")) data = orders[0] || { id: "order-1", orderNo: "TEST-ORDER-1", amount: 240, status: 0, createTime: new Date().toISOString(), payUrl: "https://checkout.example.test/qa-only" };
  else if (pathname === "/api/open/v1/models") data = models.map((model) => ({ id: model.id, modelId: model.modelKey, name: model.name, type: model.type }));
  else if (pathname.startsWith("/api/integrations/")) data = { choices: [{ message: { role: "assistant", content: "An imaginative starting point." } }] };
  else if (["/api/auth/logout", "/api/auth/email-code", "/api/auth/password", "/api/auth/reset-password", "/api/auth/register"].includes(pathname) || pathname.startsWith("/api/files/detail/")) data = {};
  else { await route.fulfill({ json: { success: false, code: 404, message: `QA fixture missing: ${pathname}`, data: null } }); return; }
  await route.fulfill({ json: { success: true, code: 200, message: "", data, timestamp: Date.now() } });
};
await context.route("**/api/**", mockApi);
await context.route("**/qa-video.mp4", (route) => route.fulfill({ status: 200, contentType: "video/mp4", body: "" }));
const goto = async (route) => { const response = await page.goto(`${base}${route}`, { waitUntil: "networkidle", timeout: 60000 }); assert.ok(response.status() < 400, `${route}: HTTP ${response.status()}`); };
const click = async (locator) => locator.click({ force: true });
const result = { routes: [], tests: [] };
try {
  await goto("/"); await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: path.join(artifacts, "home-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: path.join(artifacts, "home-mobile.png"), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "Home has horizontal overflow");
  await page.setViewportSize({ width: 1440, height: 1050 });
  await goto("/login"); await page.getByLabel("Email or username").fill("alex"); await page.getByLabel("Password", { exact: true }).fill("qa-password"); await click(page.getByRole("button", { name: "Sign in", exact: true })); await page.waitForURL("**/studio");
  result.tests.push("login");
  await checkSelects({ page, browser, context, mockApi, base, artifacts, models });
  result.tests.push("themed selects: keyboard, touch, long lists, empty values, responsive placement and focus recovery");
  await page.getByLabel("Your prompt").fill("A cinematic coastal home."); await click(page.locator(".output-options summary")); await chooseSelect(page, "Number of images", "2 images"); await click(page.getByRole("button", { name: "Generate", exact: true }));
  await page.waitForFunction(() => document.querySelector(".task-image"), { timeout: 15000 });
  const generated = requests.find((entry) => entry.path === "/api/ai/generate"); assert.equal(generated.body.input.batchCount, 2); assert.equal(generated.body.handler, "text_to_image"); assert.ok(generated.body.clientRequestId);
  result.tests.push("generation, batch billing, polling and completed preview");
  await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: path.join(artifacts, "studio-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: path.join(artifacts, "studio-mobile.png"), fullPage: true }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "Studio has horizontal overflow"); await page.setViewportSize({ width: 1440, height: 1050 });
  await goto("/studio?type=upscale"); await page.locator('input[type="file"]').setInputFiles({ name: "source.mp4", mimeType: "video/mp4", buffer: Buffer.from("qa-video") });
  await chooseSelect(page, "Enhancement level", "High"); await chooseSelect(page, "Output frame rate", "2x interpolation"); await page.getByRole("button", { name: "Enhance video", exact: true }).waitFor();
  await click(page.getByRole("button", { name: "Enhance video", exact: true })); await page.waitForResponse((response) => new URL(response.url()).pathname === "/api/ai/generate").catch(() => {});
  const upscale = requests.filter((entry) => entry.path === "/api/ai/generate").at(-1); assert.equal(upscale.body.input.upscaleModel, "high"); assert.equal(upscale.body.input.outputFps, "2x"); assert.equal("prompt" in upscale.body.input, false);
  result.tests.push("upload, RH quote and parameter forwarding");
  await goto("/playground"); await click(page.getByRole("button", { name: "Use account key" })); await page.getByLabel("API key for request").waitFor(); await click(page.getByRole("button", { name: "Load models", exact: true }));
  await click(page.getByRole("button", { name: "Run request", exact: true }));
  await page.waitForFunction(() => document.querySelector(".response-code")?.textContent.includes('"image-model"'));
  assert.doesNotMatch(await page.locator(".response-code").innerText(), /Hidden Text Model|hidden-text-model/);
  await page.getByRole("combobox", { name: "Endpoint", exact: true }).click();
  assert.equal(await page.getByRole("option", { name: "Chat completions", exact: true }).count(), 0);
  assert.equal(await page.getByRole("option", { name: "Responses API", exact: true }).count(), 0);
  await page.keyboard.press("Escape");
  await chooseSelect(page, "Endpoint", "Create a generation"); await click(page.getByRole("button", { name: "Run request", exact: true }));
  await page.waitForFunction(() => document.querySelector(".response-code")?.textContent.includes('"status": 1'), { timeout: 15000 });
  const apiCall = requests.find((entry) => entry.path === "/api/open/v1/generations"); assert.ok(apiCall.body.clientRequestId); result.tests.push("account key, developer catalog, API generation and task following");
  await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: path.join(artifacts, "playground-desktop.png"), fullPage: true });
  await goto("/pricing"); await click(page.getByRole("button", { name: "Yearly", exact: true })); await click(page.locator(".pricing-card").filter({ hasText: "Essential" }).getByRole("button", { name: "Choose this plan" }));
  await click(page.getByRole("button", { name: "Continue to checkout" })); await page.waitForURL("**/billing?order=*"); assert.equal(orders[0].amount, 240); assert.equal(requests.find((entry) => entry.path === "/api/en/orders" && entry.method === "POST").body.cycle, "yearly");
  result.tests.push("USD annual totals, configured-channel fixture, order creation and currency-aware invoice");
  const routes = ["/", "/studio", "/models", "/explore", "/developers", "/docs", "/playground", "/pricing", "/library", "/history", "/usage", "/account", "/login", "/signup", "/forgot-password", "/billing", "/about", "/help", "/terms", "/privacy", "/tools"];
  for (const route of routes) {
    await goto(route); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Desktop overflow: ${route}`);
    const text = await page.locator("body").innerText(); assert.doesNotMatch(text, /Hidden Text Model|Hidden text result|Hidden text prompt|Chat & Responses|API & chat calls/, `Text-model content leaked: ${route}`); assert.equal(/[\p{Script=Han}]/u.test(text), false, `Chinese interface copy: ${route}`); assert.equal(/FlowLight|FlowingLight|TideCanvas|imini/i.test(text), false, `Original branding: ${route}`);
    await page.setViewportSize({ width: 390, height: 844 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Mobile overflow: ${route}`); await page.setViewportSize({ width: 1440, height: 1050 }); result.routes.push(route);
  }
  await goto("/docs"); await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: path.join(artifacts, "docs-desktop.png"), fullPage: true });
  await goto("/pricing"); await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: path.join(artifacts, "pricing-desktop.png"), fullPage: true });
  assert.equal(requests.some((request) => request.path === "/api/chat-gateway/usage"), false, "The English frontend must not query token-metered text usage");
  await goto("/playground?endpoint=chat");
  assert.equal((await page.getByRole("combobox", { name: "Endpoint", exact: true }).innerText()).trim(), "List models");
  result.tests.push("media-only catalog, homepage, API responses, history and usage; legacy chat links are normalized");
  assert.deepEqual(errors, [], "Browser runtime errors");
  result.runtimeErrors = errors; result.requestsIntercepted = requests.length;
  await writeFile(path.join(artifacts, "browser-results.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
