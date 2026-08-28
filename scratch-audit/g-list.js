// 生成记录页现状截图 + 详情抽屉
const { chromium } = require("playwright-core");
const TOKEN = process.env.ADMIN_TOKEN;
const SHOTS = __dirname + "/shots";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, locale: "zh-CN" });
  await ctx.addInitScript((t) => localStorage.setItem("access_token", t), TOKEN);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 200)));
  await page.goto("http://localhost:3000/admin/generations", { waitUntil: "domcontentloaded", timeout: 90000 });
  // 等表格行出现
  await page.waitForSelector("table tbody tr", { timeout: 60000 }).catch(() => console.log("[warn] no rows"));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/g01-list.png` });

  // 打开第一条详情
  const btn = page.locator("table tbody tr button", { hasText: "详情" }).first();
  await btn.click({ timeout: 8000 }).catch(() => console.log("[warn] no detail btn"));
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${SHOTS}/g02-detail.png` });

  await browser.close();
})().catch((e) => { console.error("FATAL", String(e).slice(0, 300)); process.exit(1); });
