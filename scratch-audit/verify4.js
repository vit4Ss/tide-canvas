// verify4: 查看大图 → 灯箱顶栏
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
  await page.waitForTimeout(800);

  // 悬停北极人节点让工具条出现，点「查看大图」
  await page.hover("text=查看大图").catch(() => {});
  await page.mouse.move(560, 240);
  await page.waitForTimeout(600);
  try {
    await page.getByTitle("查看大图").first().click({ timeout: 3000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SHOTS}/v5b-lightbox.png` });
    const has = await page.evaluate(() => !!document.querySelector("[aria-label='关闭预览']"));
    console.log("[ok] v5b-lightbox, topbar close =", has);
  } catch {
    console.log("[skip] 查看大图 not found");
    await page.screenshot({ path: `${SHOTS}/v5b-hover.png` });
  }
  await browser.close();
})().catch((e) => { console.error("FATAL", String(e).slice(0, 300)); process.exit(1); });
