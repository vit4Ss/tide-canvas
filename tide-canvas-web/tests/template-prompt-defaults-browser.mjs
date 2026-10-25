import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || "playwright-core");
const base = process.env.FRONTEND_TEST_URL || "http://127.0.0.1:3319";
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : { channel: "chrome" }) });
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
await context.addInitScript(() => localStorage.setItem("access_token", "template-defaults-fixture"));
const seedance = { id: "501", modelKey: "seedance-2.5-test", name: "Seedance 2.5", type: "video", config: { modes: ["i2v"], ratios: ["16:9", "9:16"], durations: ["15s", "30s"], resolutions: ["480p", "720p", "1080p"] } };
const alternate = { ...seedance, id: "502", modelKey: "manual-video", name: "手动选择的视频模型" };
let row = { id: "81", kind: "inspiration", mediaType: "video", title: "门店宣传", prompt: "【生成视频：30秒｜9:16】\n门店镜头", description: "", category: "", coverUrl: base + "/studio-samples/v1/clay-adventure.webp", previewUrl: "", mode: "i2v", modelKey: "", requirements: { images: 1, videos: 0, audio: 0 }, options: {}, status: 0, sortOrder: 0, uses: 0 };
let pendingCheck = null, releaseCheck = () => {}, unavailable = false, paid = 0, saves = 0, singleFillCalls = 0, batchCalls = 0, loseBatchResponse = true, duplicates = false;
const batchScopes = [];
const checks = [], errors = [];
await context.route("**/api/**", async route => {
  const req = route.request(), path = new URL(req.url()).pathname;
  let data = {};
  if (path === "/api/auth/me") data = { id: "801", username: "operator", role: 9, status: 1, points: 1000, adminPerms: [], menus: ["studio"] };
  else if (path === "/api/admin/studio-templates") data = { records: [row], total: 1, pages: 1, categories: [] };
  else if (path === "/api/admin/studio-templates/fill-from-prompts") {
    batchCalls++;
    batchScopes.push(req.postDataJSON());
    assert.equal(req.postDataJSON().publish, true, "batch action only saved a draft");
    if (loseBatchResponse) { loseBatchResponse = false; return route.abort("failed"); }
    row.status = 1;
    if (!row.options.resolution || /^(480p?)$/i.test(row.options.resolution)) row.options.resolution = "720p";
    data = { publish: true, total: 3, counts: { saved: 0, published: 1, skipped: 1, failed: 1 }, items: [
      { id: "81", title: "门店宣传", status: "published", message: "配置校验通过，已上架" },
      { id: "82", title: "已配置模板", status: "skipped", message: "模型与参数已填写，无需更新" },
      { id: "83", title: "无可用模型", status: "failed", message: "Seedance 2.5 暂不可用" },
    ] };
  }
  else if (path === "/api/market/studio-models") data = [seedance, alternate, ...(duplicates ? [{ ...seedance, id: "503", name: "Seedance 2.5 另一配置" }] : [])];
  else if (path === "/api/admin/studio-templates/check") {
    const body = req.postDataJSON(); checks.push(body);
    if (pendingCheck) await pendingCheck;
    if (unavailable) return route.fulfill({ json: { success: false, code: 400, message: "未找到支持30秒的 Seedance 2.5" } });
    const options = { ...body.options };
    if (body.fillFromPrompt && (!options.resolution || /^(480p?)$/i.test(options.resolution))) options.resolution = "720p";
    data = { modelId: body.modelKey || seedance.modelKey, modelName: "Seedance 2.5", handler: "image_to_video", basePointCost: 9, options, maxUploadBytes: { image: 52428800 } };
  } else if (path === "/api/admin/studio-templates/81" && req.method() === "PUT") {
    const { expectedCoverUrl, expectedStatus, fillFromPrompt, ...body } = req.postDataJSON();
    assert.equal(typeof expectedStatus, "number", "save omitted the publication baseline");
    if (expectedStatus !== row.status && body.status !== row.status) return route.fulfill({ json: { success: false, code: 409, message: "模板上架状态已由其他操作更新" } });
    if (fillFromPrompt) {
      singleFillCalls++;
      assert.equal(body.status, 1, "single action only saved a draft");
      if (!body.coverUrl) return route.fulfill({ json: { success: false, code: 400, message: "上架前请补充封面图片" } });
      if (unavailable) return route.fulfill({ json: { success: false, code: 400, message: "自动填充失败：未找到支持30秒的 Seedance 2.5" } });
      if (!body.options.resolution || /^(480p?)$/i.test(body.options.resolution)) body.options.resolution = "720p";
    }
    row = { ...row, ...body }; saves++; data = row;
  } else if (path === "/api/ai/generate") { paid++; throw new Error("autofill must never generate"); }
  else if (path.includes("notifications")) data = path.endsWith("unread-count") ? { count: 0 } : { records: [], total: 0 };
  await route.fulfill({ json: { success: true, code: 200, data } });
});
const page = await context.newPage();
page.on("pageerror", e => errors.push(e.message));
const editor = page.getByRole("dialog", { name: "编辑创作模板", exact: true });
const open = async () => {
  await page.goto(base + "/admin/studio-templates", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^灵感做同款/ }).click();
  await page.getByRole("button", { name: "视频", exact: true }).click();
  await page.getByRole("button", { name: "编辑" + row.title, exact: true }).click();
  await editor.waitFor();
};
const select = async (name, value) => {
  await editor.getByRole("button", { name, exact: true }).click();
  await page.getByRole("listbox", { name, exact: true }).getByRole("option", { name: value, exact: true }).click();
};
try {
  await open();
  await page.waitForFunction(() => document.querySelector('[role="dialog"] button[aria-label="默认生成模型"]')?.textContent?.includes("Seedance 2.5"));
  assert.match(await editor.getByRole("button", { name: "视频时长", exact: true }).innerText(), /30/);
  assert.match(await editor.getByRole("button", { name: "画面比例", exact: true }).innerText(), /9:16/);
  assert.match(await editor.getByRole("button", { name: "清晰度", exact: true }).innerText(), /720P/i);
  assert.deepEqual(checks[0].options, { duration: 30, aspectRatio: "9:16" });
  await editor.getByRole("button", { name: "自动填充并上架", exact: true }).evaluate(button => { button.click(); button.click(); });
  await editor.waitFor({ state: "hidden" });
  assert.equal(row.modelKey, seedance.modelKey);
  assert.equal(row.options.duration, 30);
  assert.equal(row.options.resolution, "720p");
  assert.equal(row.status, 1, "single template remained a draft");
  assert.equal(singleFillCalls, 1, "double click submitted twice");

  row = { ...row, status: 0, modelKey: "", options: {} };
  pendingCheck = new Promise(resolve => { releaseCheck = resolve; });
  const before = checks.length;
  await open();
  await page.waitForFunction(() => document.body.textContent.includes("正在匹配支持30秒"));
  assert.ok(checks.length > before);
  await select("默认生成模型", alternate.name);
  releaseCheck(); pendingCheck = null;
  await editor.getByLabel("完整提示词", { exact: true }).fill("【生成视频：30秒｜9:16】\n新镜头");
  await editor.getByRole("button", { name: "保存草稿", exact: true }).click();
  await editor.waitFor({ state: "hidden" });
  assert.equal(row.modelKey, alternate.modelKey, "late automatic response overwrote manual model");

  // Saved manual specs remain authoritative even when the header changes.
  row = { ...row, options: { duration: 15, aspectRatio: "16:9", resolution: "1080p" } };
  await open();
  await editor.getByLabel("完整提示词", { exact: true }).fill("【生成视频：30秒｜1:1】\n不同画幅");
  await editor.getByRole("button", { name: "保存草稿", exact: true }).click();
  await editor.waitFor({ state: "hidden" });
  assert.deepEqual(row.options, { duration: 15, aspectRatio: "16:9", resolution: "1080p" });

  row = { ...row, modelKey: "", options: {}, prompt: "" };
  unavailable = true;
  await open();
  await editor.getByLabel("完整提示词", { exact: true }).fill("【生成视频：30秒｜9:16】\n新模板");
  await editor.getByRole("alert").filter({ hasText: "未找到支持30秒" }).waitFor();
  await select("媒体类型", "图片");
  await select("媒体类型", "视频");
  await editor.getByRole("alert").filter({ hasText: "未找到支持30秒" }).waitFor();
  const priorSaves = saves;
  await editor.getByRole("button", { name: "自动填充并上架", exact: true }).click();
  await editor.getByRole("alert").filter({ hasText: "自动填充失败" }).waitFor();
  assert.equal(saves, priorSaves, "failed fill saved incomplete data");
  assert.equal(await editor.getByLabel("完整提示词", { exact: true }).inputValue(), "【生成视频：30秒｜9:16】\n新模板");
  await editor.getByRole("button", { name: "保存草稿", exact: true }).click();
  await editor.waitFor({ state: "hidden" });
  assert.equal(row.modelKey, "");
  assert.equal(row.status, 0, "failed publication changed draft status");
  assert.deepEqual(row.options, { duration: 30, aspectRatio: "9:16" });
  assert.equal(paid, 0);
  assert.equal(saves, 4);
  // An already-open draft cannot silently undo a concurrent batch publish.
  unavailable = false;
  await open();
  row.status = 1;
  const beforeConflict = saves;
  await editor.getByLabel(/^名称/).fill("尚未保存的修改");
  await editor.getByRole("button", { name: "保存草稿", exact: true }).click();
  await editor.getByRole("alert").filter({ hasText: "上架状态已由其他操作更新" }).waitFor();
  assert.equal(row.status, 1);
  assert.equal(saves, beforeConflict);
  assert.equal(await editor.getByLabel(/^名称/).inputValue(), "尚未保存的修改");
  await editor.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("alertdialog", { name: "放弃未保存的修改？" }).getByRole("button", { name: "放弃修改", exact: true }).click();
  await editor.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "上架状态", exact: true }).click();
  await page.getByRole("option", { name: "草稿 / 已下架", exact: true }).click();
  await page.getByRole("button", { name: "批量填充并上架", exact: true }).evaluate(button => { button.click(); button.click(); });
  const batch = page.getByRole("dialog", { name: "批量填充并上架", exact: true });
  await batch.getByRole("alert").waitFor();
  assert.equal(batchCalls, 1);
  await batch.getByRole("button", { name: "重试填充并上架", exact: true }).click();
  await batch.getByRole("list", { name: "自动填充结果" }).waitFor();
  assert.equal(batchCalls, 2);
  assert.deepEqual(batchScopes[0], batchScopes[1]);
  assert.equal(batchScopes[0].mediaType, "video");
  assert.equal(batchScopes[0].kind, "inspiration");
  assert.equal(batchScopes[0].status, "0");
  assert.equal(row.status, 1, "batch result left a ready template as a draft");
  await batch.getByText("配置校验通过，已上架", { exact: true }).waitFor();
  await batch.getByText(/上架成功的模板会从草稿筛选中移出/).waitFor();
  await batch.getByText("Seedance 2.5 暂不可用", { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await batch.evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
  await batch.getByRole("button", { name: "完成", exact: true }).click();
  await batch.waitFor({ state: "hidden" });
  duplicates = true;
  row = { ...row, status: 0, modelKey: seedance.modelKey };
  await page.setViewportSize({ width: 1440, height: 1050 });
  await open();
  await editor.getByRole("button", { name: "自动填充并上架", exact: true }).click();
  await editor.waitFor({ state: "hidden" });
  assert.equal(row.modelKey, seedance.id, "ambiguous legacy key did not pin the displayed catalog row");
  await open();
  await select("默认生成模型", "Seedance 2.5 另一配置");
  await editor.getByRole("button", { name: "自动填充并上架", exact: true }).click();
  await editor.waitFor({ state: "hidden" });
  assert.equal(row.modelKey, "503", "duplicate key selected a different catalog row");
  row.options.resolution = "480p";
  await page.getByRole("button", { name: "上架状态", exact: true }).click();
  await page.getByRole("option", { name: "已上架", exact: true }).click();
  await page.getByRole("button", { name: "批量填充并上架", exact: true }).click();
  await batch.getByRole("list", { name: "自动填充结果" }).waitFor();
  assert.equal(batchScopes.at(-1).status, "1");
  assert.equal(row.options.resolution, "720p", "re-clicking did not refresh a published 480p template");
  assert.equal(row.status, 1);
  await batch.getByRole("button", { name: "完成", exact: true }).click();
  assert.equal(paid, 0);
  assert.deepEqual(errors, []);
  console.log("PASS: header defaults, Seedance selection, single and batch publication, failed drafts preserved, double-click guards, retries, mobile layout, manual choices and zero paid calls.");
} catch (error) {
  console.log(JSON.stringify({ errors, checks, body: (await page.locator("body").innerText()).slice(-5500) }));
  throw error;
} finally {
  releaseCheck();
  await browser.close();
}
