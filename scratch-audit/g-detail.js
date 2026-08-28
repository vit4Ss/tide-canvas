// 详情抽屉完整内容截图（成功记录 + 失败记录）
const { chromium } = require("playwright-core");
const TOKEN = process.env.ADMIN_TOKEN;
const SHOTS = __dirname + "/shots";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, locale: "zh-CN" });
  await ctx.addInitScript((t) => localStorage.setItem("access_token", t), TOKEN);
  const page = await ctx.newPage();
  await page.goto("http://localhost:3000/admin/generations", { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForSelector("table tbody tr", { timeout: 60000 });
  await page.waitForTimeout(1500);

  // 成功记录详情（第一行，有图片结果）
  await page.locator("table tbody tr button", { hasText: "详情" }).first().click();
  await page.waitForSelector(".genr-grid", { timeout: 30000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/g03-detail-success.png` });
  // 抽屉滚到底看原始报文/技术信息
  await page.locator(".adm-drawer-body, [class*=drawer]").last().evaluate((el) => el.scrollTo(0, el.scrollHeight)).catch(() => {});
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${SHOTS}/g04-detail-bottom.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);

  // 失败记录详情（状态=失败 pill 所在行）
  const failRow = page.locator("table tbody tr", { hasText: "失败" }).first();
  await failRow.locator("button", { hasText: "详情" }).click();
  await page.waitForSelector(".genr-grid", { timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${SHOTS}/g05-detail-fail.png` });

  await browser.close();
})().catch((e) => { console.error("FATAL", String(e).slice(0, 300)); process.exit(1); });
