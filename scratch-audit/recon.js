// 画布 UI 走查 - 侦察脚本：登录 → 打开画布 → 截图 → 转储可交互元素
const { chromium } = require("playwright-core");
const fs = require("fs");

const TOKEN = process.env.CANVAS_TOKEN;
const BASE = "http://localhost:3000";
const CANVAS_URL = BASE + "/canvas/1ad61fc8a0f11130f870d3960a10abc9";
const SHOTS = __dirname + "/shots";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 1,
    locale: "zh-CN",
  });
  await ctx.addInitScript((token) => {
    localStorage.setItem("access_token", token);
  }, TOKEN);
  const page = await ctx.newPage();
  page.on("console", (m) => {
    if (m.type() === "error") console.log("[console.error]", m.text().slice(0, 200));
  });
  page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 300)));

  await page.goto(CANVAS_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  // 等画布节点或加载态出现
  await page.waitForTimeout(12000);
  await page.screenshot({ path: SHOTS + "/01-canvas-initial.png", fullPage: false });

  // 转储可交互元素
  const dump = await page.evaluate(() => {
    const els = [...document.querySelectorAll("button, select, [role=button], input, textarea")];
    return els
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      })
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || "").trim().slice(0, 40),
        aria: el.getAttribute("aria-label"),
        title: el.getAttribute("title"),
        cls: (el.className && typeof el.className === "string" ? el.className : "").slice(0, 80),
        rect: (() => { const r = el.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; })(),
      }));
  });
  fs.writeFileSync(__dirname + "/interactive-dump.json", JSON.stringify(dump, null, 1));
  console.log("interactive elements:", dump.length);
  console.log("url now:", page.url());
  await browser.close();
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
