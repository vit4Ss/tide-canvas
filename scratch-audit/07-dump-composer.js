// 07: 转储快捷面板 DOM（通过 textarea 祖先链）
const { chromium } = require("playwright-core");
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

  const out = await page.evaluate(() => {
    const tas = [...document.querySelectorAll("textarea")].filter((t) => {
      const r = t.getBoundingClientRect();
      return r.width > 0 && r.y > 0 && r.y < 900;
    });
    if (!tas.length) return "(no visible textarea)";
    // 找包含按钮的最近祖先
    let el = tas[0];
    for (let i = 0; i < 8 && el.parentElement; i++) {
      el = el.parentElement;
      if (el.querySelectorAll("button").length >= 3) break;
    }
    const strip = (s) => s.replace(/class="[^"]*"/g, "").replace(/\s+/g, " ");
    return strip(el.outerHTML).slice(0, 4000);
  });
  console.log(out);
  await browser.close();
})().catch((e) => { console.error("FATAL", String(e).slice(0, 300)); process.exit(1); });
