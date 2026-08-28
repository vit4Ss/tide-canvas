// 用户管理页截图（本地最新代码）
const { chromium } = require("playwright-core");
const TOKEN = process.env.ADMIN_TOKEN;
const SHOTS = __dirname + "/shots";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, locale: "zh-CN" });
  await ctx.addInitScript((t) => localStorage.setItem("access_token", t), TOKEN);
  const page = await ctx.newPage();
  await page.goto("http://localhost:3000/admin/users", { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForSelector("table tbody tr", { timeout: 60000 });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${SHOTS}/u01-users.png` });
  // 表头特写
  await page.screenshot({ path: `${SHOTS}/u02-users-head.png`, clip: { x: 230, y: 60, width: 1370, height: 120 } });
  await browser.close();
})().catch((e) => { console.error("FATAL", String(e).slice(0, 300)); process.exit(1); });
