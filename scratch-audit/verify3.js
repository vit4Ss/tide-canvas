// verify3: 灯箱顶栏 + 历史 skeleton/Esc
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

  // v5: 单击北极人节点图片 → 灯箱
  await page.mouse.click(560, 240);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${SHOTS}/v5-lightbox.png` });
  const hasLightbox = await page.evaluate(() => !!document.querySelector("[aria-label='关闭预览']"));
  console.log("[ok] v5-lightbox, topbar close btn =", hasLightbox);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  // v6: 历史 skeleton + Esc
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
