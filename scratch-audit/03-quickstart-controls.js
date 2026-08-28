// 03: 确认 N 圆点身份 + 走查快捷生成面板与各下拉框
const { chromium } = require("playwright-core");
const TOKEN = process.env.CANVAS_TOKEN;
const SHOTS = __dirname + "/shots";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, locale: "zh-CN" });
  await ctx.addInitScript((t) => localStorage.setItem("access_token", t), TOKEN);
  const page = await ctx.newPage();
  await page.goto("http://localhost:3000/canvas/1ad61fc8a0f11130f870d3960a10abc9", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(10000);

  // 1) N 圆点身份
  const portalHtml = await page.evaluate(() => {
    const p = document.querySelector("nextjs-portal");
    return p ? p.innerHTML.slice(0, 400) : "(no nextjs-portal)";
  });
  console.log("[portal]", portalHtml.replace(/\s+/g, " ").slice(0, 300));

  // 2) 适应视图 → 打开新增节点 → 选「图片」进入快捷生成
  await page.getByTitle("适应视图").click();
  await page.waitForTimeout(800);
  await page.getByTitle("新增节点").click();
  await page.waitForTimeout(800);
  await page.getByText("图片", { exact: false }).first().click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: SHOTS + "/04-quickstart-image.png" });

  // 3) 转储快捷面板内的控件
  const controls = await page.evaluate(() => {
    const els = [...document.querySelectorAll("select, button")].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.x > 0 && r.x < 1600 && r.y > 0 && r.y < 900;
    });
    return els.map((el) => ({
      tag: el.tagName.toLowerCase(),
      text: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 50),
      aria: el.getAttribute("aria-label"),
      title: el.getAttribute("title"),
      rect: (() => { const r = el.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; })(),
    }));
  });
  console.log(JSON.stringify(controls, null, 1));
  await browser.close();
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
