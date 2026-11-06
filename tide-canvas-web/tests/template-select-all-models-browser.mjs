import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || "playwright-core");
const base = process.env.FRONTEND_TEST_URL || "http://127.0.0.1:3215";
const directory = ".runtime/template-select-all-models-review";
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "chrome" });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addInitScript(() => localStorage.setItem("access_token", "select-all-fixture"));
const row = {
  id: "1", kind: "style", mediaType: "image", title: "模型批量配置示例", description: "", category: "", inputLabels: {},
  coverUrl: "/studio-samples/v1/clay-adventure.webp", previewUrl: "", authorName: "",
  inputHint: "", prompt: "recipe", mode: "i2i", modelKey: "image-default", selectableModelKeys: [],
  requirements: { images: 1, videos: 0, audio: 0 }, options: { aspectRatio: "1:1" }, status: 0, sortOrder: 0, uses: 0,
};
const calls = [];
let failSecondChunk = true;
let paidCalls = 0;
await context.route("**/api/**", async route => {
  const req = route.request(), url = new URL(req.url()), path = url.pathname;
  let data = {};
  if (path === "/api/auth/me") data = { id: "801", username: "operator", role: 9, status: 1, points: 1000, adminPerms: [], menus: ["studio"] };
  else if (path === "/api/admin/studio-templates") data = { records: [row], total: 1, pages: 1, categories: [] };
  else if (path === "/api/market/studio-models") data = [
    { id: "31", name: "Default image", modelKey: "image-default", type: "image", config: { modes: ["i2i"], ratios: ["1:1"] } },
    { id: "32", name: "Compatible image", modelKey: "image-compatible", type: "image", config: { modes: ["i2i"], ratios: ["1:1"] } },
  ];
  else if (path === "/api/admin/studio-templates/select-all-models") {
    const body = req.postDataJSON(); calls.push(body);
    assert.deepEqual(Object.keys(body).sort(), body.afterId ? ["afterId", "throughId"] : []);
    if (body.afterId && failSecondChunk) {
      failSecondChunk = false;
      return route.abort("failed");
    }
    await new Promise(resolve => setTimeout(resolve, 150));
    const wasSelected = row.selectableModelKeys.length > 0;
    row.selectableModelKeys = ["image-compatible"];
    if (!body.afterId) {
      data = { total: 12, updated: wasSelected ? 0 : 9, unchanged: wasSelected ? 9 : 0, skipped: 1, failed: 0, throughId: "12", nextAfterId: "10", done: false,
        items: Array.from({ length: 10 }, (_, i) => ({ id: String(i+1), title: i === 0 ? row.title : `模板 ${i+1}`, status: i === 9 ? "skipped" : wasSelected ? "unchanged" : "updated", models: i === 9 ? 0 : 2, message: i === 9 ? "生成配方尚未配置" : "已勾选全部兼容模型" })) };
    } else {
      assert.deepEqual(body, { afterId: "10", throughId: "12" });
      data = { total: 12, updated: 1, unchanged: 1, skipped: 0, failed: 0, throughId: "12", nextAfterId: "0", done: true,
        items: [{ id: "11", title: "视频草稿模板", status: "updated", models: 3, message: "已勾选全部兼容模型" }, { id: "12", title: "已上架视频模板", status: "unchanged", models: 2, message: "全部兼容模型已勾选" }] };
    }
  } else if (path === "/api/ai/generate") { paidCalls++; throw new Error("bulk select must not generate"); }
  else if (path.includes("notifications")) data = path.endsWith("unread-count") ? { count: 0 } : { records: [], total: 0 };
  await route.fulfill({ json: { success: true, code: 200, data } });
});

const page = await context.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
page.on("console", message => {
  if (message.type() === "error" && message.text().includes("页面渲染错误")) errors.push(message.text());
});
const label = "一键勾选全部兼容模型";
const dialog = page.getByRole("dialog", { name: label, exact: true });
try {
  await page.goto(base + "/admin/studio-templates", { waitUntil: "networkidle" });
  const button = page.getByRole("button", { name: label, exact: true });
  await button.click();
  await dialog.getByText(/覆盖全部分页、图片和视频/).waitFor();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(calls.length, 0, "opening or cancelling the dialog mutated data");

  await button.click();
  await dialog.getByRole("button", { name: "开始批量勾选", exact: true }).evaluate(el => { el.click(); el.click(); });
  await dialog.getByRole("alert").filter({ hasText: /部分模板可能已保存/ }).waitFor();
  assert.equal(calls.length, 2, "double click duplicated the batch");
  assert.deepEqual(calls[0], {});
  assert.deepEqual(calls[1], { afterId: "10", throughId: "12" });
  await dialog.getByText(/已更新 9 个/).waitFor();
  await dialog.getByRole("button", { name: "重新执行", exact: true }).click();
  await dialog.getByText(/处理完成，共 12 个模板/).waitFor();
  assert.equal(calls.length, 4);
  await dialog.getByText(/已更新 1 个，已勾全 10 个，跳过 1 个，未完成 0 个/).waitFor();
  await dialog.getByText("视频草稿模板", { exact: true }).waitFor();
  await dialog.getByText(/生成配方尚未配置/).waitFor();
  await page.screenshot({ path: `${directory}/desktop.png`, fullPage: true });

  for (const width of [1024, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await dialog.evaluate(el => el.scrollWidth > el.clientWidth + 1), false, `dialog overflow at ${width}`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `page overflow at ${width}`);
    if (width === 390) await page.screenshot({ path: `${directory}/mobile.png`, fullPage: true });
  }
  await dialog.getByRole("button", { name: "完成", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "编辑" + row.title, exact: true }).click();
  const editor = page.getByRole("dialog", { name: "编辑创作模板", exact: true });
  await editor.getByLabel("允许用户选择Compatible image", { exact: true }).waitFor();
  assert.equal(await editor.getByLabel("允许用户选择Compatible image", { exact: true }).isChecked(), true);
  assert.equal(row.status, 0);
  assert.equal(row.modelKey, "image-default");
  assert.equal(paidCalls, 0);
  assert.deepEqual(errors, []);
  console.log("PASS: global scope, chunk progress, double-click guard, partial response loss, retry, saved checkbox restoration, desktop/mobile and zero paid calls.");
} catch (error) {
  console.log(JSON.stringify({ calls, errors, body: (await page.locator("body").innerText()).slice(-5000) }));
  throw error;
} finally {
  await browser.close();
}
