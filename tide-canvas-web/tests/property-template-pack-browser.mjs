import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile } from "node:fs/promises";

const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || "playwright-core");
const base = process.env.FRONTEND_TEST_URL || "http://127.0.0.1:3319";
const pack = JSON.parse(await readFile(new URL("../../tide-canvas-server/internal/handler/studiotemplate/content-packs/property-general-v3/catalog.json", import.meta.url), "utf8"));
const prior = JSON.parse(await readFile(new URL("../../tide-canvas-server/internal/handler/studiotemplate/content-packs/store-food-v002/catalog.json", import.meta.url), "utf8"));
const rows = [
  { ...prior.entries[0].template, id: "100", uses: 0 },
  ...pack.entries.map((entry, i) => ({ ...entry.template, id: String(1000 + i), uses: 0 })),
];
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : { channel: "chrome" }) });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addInitScript(() => localStorage.setItem("access_token", "property-fixture"));
const errors = [];
let paid = 0, checks = 0;
await context.route("**/api/**", async route => {
  const req = route.request(), url = new URL(req.url()), path = url.pathname;
  let data = {};
  if (path === "/api/auth/me") data = { id: "801", username: "operator", role: 9, status: 1, points: 1000, adminPerms: [], menus: ["studio"] };
  else if (path === "/api/admin/studio-templates") {
    const q = Object.fromEntries(url.searchParams);
    let matching = rows.filter(r => (!q.kind || r.kind === q.kind) && (!q.mediaType || r.mediaType === q.mediaType) && (!q.status || String(r.status) === q.status));
    const categories = [...new Set(matching.map(r => r.category))];
    matching = matching.filter(r => (!q.category || r.category === q.category) && (!q.keyword || (r.title + r.description).includes(q.keyword)))
      .sort((a, b) => (q.order === "newest" ? 0 : a.sortOrder - b.sortOrder) || Number(b.id) - Number(a.id));
    const pageNum = Number(q.pageNum || 1), pageSize = Number(q.pageSize || 18);
    data = { records: matching.slice((pageNum - 1) * pageSize, pageNum * pageSize), total: matching.length, pages: Math.ceil(matching.length / pageSize), pageNum, pageSize, categories };
  } else if (path === "/api/market/studio-models") {
    data = [{ id: "41", modelKey: "seedance-2.5-property", name: "Seedance 2.5", type: "video", config: { modes: ["omni_ref"], ratios: ["9:16"], durations: ["30s"], resolutions: ["480p", "720p", "1080p"], refLimits: { "omniRef.imageCount": 5 } } }];
  } else if (path === "/api/admin/studio-templates/check") {
    checks++;
    const body = req.postDataJSON();
    assert.equal(body.options.duration, 30);
    assert.equal(body.options.resolution, "720p");
    assert.equal(body.requirements.images, 5);
    assert.deepEqual(body.requirements.optionalImages, [1, 3, 4, 5]);
    data = { modelId: "seedance-2.5-property", modelName: "Seedance 2.5", handler: "reference_to_video", basePointCost: 7, options: body.options, maxUploadBytes: { image: 52428800 } };
  } else if (path === "/api/ai/generate") { paid++; throw new Error("opening a template must not generate"); }
  else if (path.includes("notifications")) data = path.endsWith("unread-count") ? { count: 0 } : { records: [], total: 0 };
  await route.fulfill({ json: { success: true, code: 200, data } });
});
const page = await context.newPage();
page.on("pageerror", e => errors.push(e.message));
const cards = page.locator(".adm-content article");
const category = async value => {
  await page.getByRole("button", { name: "模板分类", exact: true }).click();
  await page.getByRole("listbox", { name: "模板分类", exact: true }).getByRole("option", { name: value, exact: true }).click();
};
try {
  await page.goto(base + "/admin/studio-templates", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^灵感做同款/ }).click();
  await page.getByRole("button", { name: "视频", exact: true }).click();
  await page.getByRole("heading", { name: "物业30 服务团队招募 · 30秒", exact: true }).waitFor();
  await category("日常服务");
  await page.waitForFunction(() => document.querySelectorAll(".adm-content article").length === 5);
  await page.getByRole("button", { name: "编辑物业01 清晨开园 · 30秒", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "编辑创作模板", exact: true });
  await editor.getByRole("button", { name: "默认生成模型", exact: true }).filter({ hasText: "Seedance 2.5" }).waitFor();
  assert.equal(await editor.getByRole("spinbutton", { name: "参考图片数量", exact: true }).inputValue(), "5");
  const options = editor.getByRole("group", { name: "可选图片位置" }).getByRole("checkbox");
  assert.equal(await options.count(), 5);
  for (let i = 0; i < 5; i++) assert.equal(await options.nth(i).isChecked(), i !== 1);
  const prompt = await editor.getByLabel("完整提示词", { exact: true }).inputValue();
  assert.equal((prompt.match(/【镜\d{2}｜/g) || []).length, 15);
  assert.equal(prompt.includes("【随机换版入口】"), false);
  assert.ok(prompt.includes("{{image:2}}"));
  assert.match(await editor.getByRole("button", { name: "清晰度", exact: true }).innerText(), /720P/i);
  assert.match(await editor.getByRole("button", { name: "视频时长", exact: true }).innerText(), /30/);
  await editor.getByRole("button", { name: "检查生成配置", exact: true }).click();
  await editor.getByText("配置检查通过", { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await editor.evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
  await mkdir(".runtime/property-pack-review", { recursive: true });
  await page.screenshot({ path: ".runtime/property-pack-review/editor-mobile.png", fullPage: true, animations: "disabled" });
  await editor.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("alertdialog", { name: "放弃未保存的修改？" }).getByRole("button", { name: "放弃修改", exact: true }).click();
  await editor.waitFor({ state: "hidden" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await category("全部分类");
  await page.getByRole("textbox", { name: "搜索模板", exact: true }).fill("物业");
  await page.getByRole("button", { name: "查询", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll(".adm-content article").length === 18);
  const first = await cards.locator("h3").allTextContents();
  const pager = page.getByRole("navigation", { name: "模板分页", exact: true });
  await pager.getByRole("button", { name: "下一页", exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll(".adm-content article").length === 12);
  const second = await cards.locator("h3").allTextContents();
  assert.deepEqual(new Set([...first, ...second]), new Set(pack.entries.map(e => e.template.title)));
  await page.screenshot({ path: ".runtime/property-pack-review/catalog-desktop.png", fullPage: true, animations: "disabled" });
  assert.ok(checks >= 2);
  assert.equal(paid, 0);
  assert.deepEqual(errors, []);
  console.log("PASS: all 30 property templates across pages, categories, editor reference roles, Seedance 2.5/30s/720p defaults, mobile layout and no paid calls.");
} catch (error) {
  console.log(JSON.stringify({ errors, body: (await page.locator("body").innerText()).slice(-4000) }));
  throw error;
} finally { await browser.close(); }
