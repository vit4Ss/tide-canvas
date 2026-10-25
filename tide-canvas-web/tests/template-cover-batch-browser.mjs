import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || "playwright-core");
const base = process.env.FRONTEND_TEST_URL || "http://127.0.0.1:3319";
const dir = ".runtime/template-cover-batch-review";
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : { channel: "chrome" }) });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addInitScript(() => localStorage.setItem("access_token", "cover-batch-fixture"));
const image = { id: "41", name: "封面图片模型", modelKey: "cover-image", type: "image", description: "", price: "7", pointCost: "7", status: 1, enabled: true, sortOrder: 0, useCount: 0, config: { modes: ["t2i"], ratios: ["16:9"], resolutions: ["2k"], qualities: ["high"] } };
let job = null, owner = "801", createCalls = 0, submits = 0, requestID = "", loseResponse = true, stopCalls = 0, finish = false, getFails = false, balance = 100;
const errors = [];
let previewCalls = 0;
await context.route("**/api/**", async route => {
  const req = route.request(), url = new URL(req.url()), path = url.pathname;
  let data = {};
  const fail = message => route.fulfill({ status: 400, json: { success: false, code: 400, message } });
  if (path === "/api/auth/me") data = { id: owner, username: "operator", nickname: "Operator", role: 9, status: 1, points: balance, adminPerms: [], menus: ["studio"] };
  else if (path === "/api/admin/models") data = { records: [image], total: 1, pages: 1, pageNum: 1, pageSize: 20 };
  else if (path === "/api/admin/models/41" && req.method() === "PUT") { Object.assign(image, req.postDataJSON()); data = image; }
  else if (path === "/api/admin/ai-models" || path === "/api/admin/ai-providers" || path === "/api/market/categories") data = [];
  else if (path === "/api/admin/studio-templates") data = { records: [], total: 0, pages: 1, categories: [] };
  else if (path === "/api/admin/studio-templates/cover-batches/current") data = owner === "801" ? job : null;
  else if (path === "/api/admin/studio-templates/cover-batches/preview") {
    previewCalls++;
    if (!image.config.templateCoverBatch) return fail("请先在模型管理中开启创作模板批量封面");
    data = { count: 3, modelId: image.modelKey, modelName: image.name, unitCost: 7, totalCost: 21, balance, quoteToken: "quoted-batch" };
  } else if (path === "/api/admin/studio-templates/cover-batches" && req.method() === "POST") {
    const body = req.postDataJSON(); createCalls++;
    if (requestID) assert.equal(body.clientRequestId, requestID, "ambiguous retry changed its request ID");
    requestID = body.clientRequestId;
    assert.equal(body.quoteToken, "quoted-batch");
    if (!job) job = { id: "901", status: "running", modelName: image.name, unitCost: 7, totalCost: 21, total: 3, stopRequested: false, error: "", counts: { pending: 2, running: 1, succeeded: 0, failed: 0, skipped: 0 }, items: [
      { templateId: "1", title: "首个模板", taskId: "1001", status: "running", message: "", resultUrl: "", pointCost: 7 },
      { templateId: "2", title: "第二个模板", taskId: "0", status: "pending", message: "", resultUrl: "", pointCost: 0 },
      { templateId: "3", title: "第三个模板", taskId: "0", status: "pending", message: "", resultUrl: "", pointCost: 0 },
    ] };
    if (loseResponse) { loseResponse = false; return route.abort("failed"); }
    data = job;
  } else if (path.endsWith("/cover-batches/901/stop")) { stopCalls++; job.stopRequested = true; data = { ok: true }; }
  else if (path.endsWith("/cover-batches/901")) {
    if (getFails) return fail("模拟进度网络失败");
    if (finish) {
      job.status = "stopped";
      job.counts = { pending: 0, running: 0, succeeded: 1, failed: 0, skipped: 2 };
      job.items[0] = { ...job.items[0], status: "succeeded", message: "封面已保存", resultUrl: base + "/studio-samples/v1/clay-adventure.webp" };
      for (const item of job.items.slice(1)) { item.status = "skipped"; item.message = "已停止后续生成"; }
    }
    data = job;
  } else if (path === "/api/ai/generate") { submits++; return fail("batch UI must not issue individual generation requests"); }
  else if (path.includes("notifications")) data = path.endsWith("unread-count") ? { count: 0 } : { records: [], total: 0 };
  await route.fulfill({ json: { success: true, code: 200, data } });
});
const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
try {
  await page.goto(base + "/admin/models", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "配置", exact: true }).click();
  const modelEditor = page.getByRole("dialog", { name: "配置模型 · 封面图片模型" });
  const toggle = modelEditor.getByRole("switch", { name: "创作模板批量封面", exact: true });
  assert.equal(await toggle.getAttribute("aria-checked"), "false", "existing image model opted into batch covers by default");
  await toggle.click();
  await modelEditor.getByRole("button", { name: "保存", exact: true }).click();
  await modelEditor.waitFor({ state: "hidden" });
  assert.equal(image.config.templateCoverBatch, true);
  await page.getByText("模板封面", { exact: true }).waitFor();
  image.config.templateCoverBatch = false;
  await page.goto(base + "/admin/studio-templates", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "批量生成封面", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "批量生成缺失封面", exact: true });
  await dialog.getByRole("alert").filter({ hasText: "请先在模型管理" }).waitFor();
  assert.equal(await dialog.getByRole("button", { name: "确认生成", exact: true }).isDisabled(), true);
  image.config.templateCoverBatch = true; balance = 10;
  await dialog.getByRole("button", { name: "重新检查", exact: true }).click();
  await dialog.getByText(/积分不足/).waitFor();
  assert.equal(await dialog.getByRole("button", { name: "确认生成", exact: true }).isDisabled(), true);
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  balance = 100;
  await page.getByRole("button", { name: "批量生成封面", exact: true }).click();
  await dialog.getByText("21", { exact: true }).waitFor();
  assert.equal(createCalls, 0);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await dialog.evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
    if (width !== 320) await page.screenshot({ path: dir + "/preview-" + width + ".png", fullPage: true, animations: "disabled" });
  }
  await dialog.getByRole("button", { name: "确认生成", exact: true }).click();
  await dialog.getByRole("alert").waitFor();
  await dialog.getByRole("button", { name: "确认生成", exact: true }).click();
  await dialog.getByRole("progressbar", { name: "批量封面进度" }).waitFor();
  assert.equal(createCalls, 2);
  await dialog.getByRole("button", { name: "收起进度", exact: true }).click();
  const previousQuotes = previewCalls;
  image.config.templateCoverBatch = false;
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "批量生成封面", exact: true }).click();
  await dialog.getByRole("progressbar", { name: "批量封面进度" }).waitFor();
  assert.equal(createCalls, 2, "reload submitted a fresh batch");
  assert.equal(previewCalls, previousQuotes, "existing progress was blocked by re-quoting an unavailable model");
  getFails = true;
  await dialog.getByRole("alert").filter({ hasText: "模拟进度网络失败" }).waitFor();
  getFails = false;
  await dialog.getByRole("button", { name: "重新读取进度", exact: true }).click();
  await dialog.getByRole("button", { name: "停止后续生成", exact: true }).click();
  assert.equal(stopCalls, 1);
  finish = true;
  await dialog.getByText("已停止后续生成", { exact: true }).first().waitFor();
  await dialog.getByRole("button", { name: "完成", exact: true }).waitFor();
  assert.equal(createCalls, 2);
  assert.equal(submits, 0);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: dir + "/result.png", fullPage: true, animations: "disabled" });
  assert.deepEqual(errors, []);
  console.log("PASS: model opt-in, disabled/insufficient gates, cost preview, same-request retry, reload recovery, polling retry, stop and responsive layout.");
} catch (error) {
  await page.screenshot({ path: dir + "/failure.png", fullPage: true }).catch(() => {});
  console.log(JSON.stringify({ errors, body: (await page.locator("body").innerText()).slice(-4000) })); throw error;
} finally { await browser.close(); }
