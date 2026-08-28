// 复查：列表(等真行) + 成功详情 + 失败详情
const { chromium } = require("playwright-core");
const TOKEN = process.env.ADMIN_TOKEN;
const SHOTS = __dirname + "/shots";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, locale: "zh-CN" });
  await ctx.addInitScript((t) => localStorage.setItem("access_token", t), TOKEN);
  const page = await ctx.newPage();
  await page.goto("http://localhost:3000/admin/generations", { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForSelector("button:has-text('详情')", { timeout: 60000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${SHOTS}/g06-list-fixed.png` });

  await page.locator("table tbody tr button", { hasText: "详情" }).first().click();
  await page.waitForSelector(".genr-grid", { timeout: 30000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/g07-detail-fixed.png` });

  await browser.close();
})().catch((e) => { console.error("FATAL", String(e).slice(0, 300)); process.exit(1); });
