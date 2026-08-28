// 08: 打开快捷面板后转储全部可见交互元素（含 SVG 类名）
const { chromium } = require("playwright-core");
const fs = require("fs");
const TOKEN = process.env.CANVAS_TOKEN;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, locale: "zh-CN" });
  await ctx.addInitScript((t) => localStorage.setItem("access_token", t), TOKEN);
  const page = await ctx.newPage();
  await page.goto("http://localhost:3000/canvas/1ad61fc8a0f11130f870d3960a10abc9", { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.getByTitle("适应视图").waitFor({ state: "visible", timeout: 90000 });
  await page.getByTitle("适应视图").click();
  await page.waitForTimeout(500);
  await page.getByTitle("新增节点").click();
  await page.waitForTimeout(600);
  await page.locator("div[role=menu]").getByText("图片", { exact: true }).click();
  await page.waitForTimeout(1200);

  const dump = await page.evaluate(() => {
    const els = [...document.querySelectorAll("button, select, [role=button], [contenteditable=true], textarea")];
    return els
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.x >= 0 && r.x < 1600 && r.y >= 0 && r.y < 900;
      })
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 35),
        aria: el.getAttribute("aria-label"),
        title: el.getAttribute("title"),
        svgCls: el.querySelector("svg")?.getAttribute("class")?.split(" ").slice(0, 3).join(" ") || null,
        rect: (() => { const r = el.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y)]; })(),
      }));
  });
  fs.writeFileSync(__dirname + "/composer-dump.json", JSON.stringify(dump, null, 1));
  console.log("count:", dump.length);
  // 只打印快捷面板区域（y > 600）的元素
  console.log(JSON.stringify(dump.filter((d) => d.rect[1] > 600), null, 1));
  await browser.close();
})().catch((e) => { console.error("FATAL", String(e).slice(0, 300)); process.exit(1); });
