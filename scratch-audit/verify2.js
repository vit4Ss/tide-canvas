// verify2: 助手打开态重开快捷面板 + 风格卡 + 灯箱 + 历史
const { chromium } = require("playwright-core");
const TOKEN = process.env.CANVAS_TOKEN;
const SHOTS = __dirname + "/shots";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, locale: "zh-CN" });
  await ctx.addInitScript((t) => localStorage.setItem("access_token", t), TOKEN);
  const page = await ctx.newPage();
  await page.goto("http://localhost:3000/canvas/1ad61fc8a0f11130f870d3960a10abc9", { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.getByTitle("适应视图").waitFor({ state: "visible", timeout: 90000 });
  await page.getByTitle("适应视图").click();
  await page.waitForTimeout(500);

  // v2b: 助手打开 → 再开快捷面板 → 应右缩不重叠
  await page.getByTitle("AI 小助手").click();
  await page.waitForTimeout(1000);
  await page.getByTitle("新增节点").click();
  await page.waitForTimeout(600);
  await page.locator("div[role=menu]").getByText("图片", { exact: true }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/v2b-avoid-expanded.png` });
  console.log("[ok] v2b-avoid-expanded");

  // v4: 风格弹窗
  await page.locator("button", { hasText: "风格" }).first().click();
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${SHOTS}/v4-style-cards.png` });
  console.log("[ok] v4-style-cards");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  // 关助手、关快捷面板
  await page.getByTitle("AI 小助手").click();
  await page.waitForTimeout(600);

  // v5: 点击北极人节点图片开灯箱（双击尝试）
  await page.mouse.dblclick(560, 240);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${SHOTS}/v5-lightbox.png` });
  console.log("[ok] v5-lightbox");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  // v6: 历史 skeleton + Esc 关闭
  await page.getByTitle("历史记录").click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${SHOTS}/v6-history-skeleton.png` });
  await page.waitForTimeout(1500);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/v6-history-esc.png` });
  console.log("[ok] v6-history");

  await browser.close();
})().catch((e) => { console.error("FATAL", String(e).slice(0, 300)); process.exit(1); });
