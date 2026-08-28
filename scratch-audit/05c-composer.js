// 05c: 等待画布就绪（替代固定 sleep）
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
  await page.waitForTimeout(500);
  await page.getByTitle("新增节点").click();
  await page.waitForTimeout(600);
  await page.locator("div[role=menu]").getByText("图片", { exact: true }).click();
  await page.waitForTimeout(1200);

  const btns = await page.evaluate(() => {
    const fixed = [...document.querySelectorAll("div")].find((d) => {
      const s = getComputedStyle(d);
      return s.position === "fixed" && d.querySelector("textarea");
    });
    if (!fixed) return "(composer not found)";
    return [...fixed.querySelectorAll("button")].map((b) => ({
      text: (b.textContent || "").trim().replace(/\s+/g, " ").slice(0, 30),
      aria: b.getAttribute("aria-label"),
      title: b.getAttribute("title"),
    }));
  });
  console.log(JSON.stringify(btns, null, 1));

  const tries = [
    ["12-style", "button:has-text('风格')"],
    ["13-skill", "button[aria-label*='技能'],button[title*='技能']"],
    ["14-attach", "button[aria-label*='附件'],button[aria-label*='素材'],button[title*='素材'],button[aria-label*='参考'],button[title*='附件']"],
  ];
  for (const [name, sel] of tries) {
    try {
      await page.locator(sel).first().click({ timeout: 2500 });
      await page.waitForTimeout(900);
      await page.screenshot({ path: `${SHOTS}/${name}.png` });
      console.log(`[ok] ${name}`);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
    } catch {
      console.log(`[skip] ${name}`);
    }
  }
  await browser.close();
})().catch((e) => { console.error("FATAL", String(e).slice(0, 300)); process.exit(1); });
