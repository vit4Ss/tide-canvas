// 05: 快捷面板内部控件（风格/技能/附件/@）+ 弹窗套弹窗
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

  await page.getByTitle("适应视图").click();
  await page.waitForTimeout(500);
  await page.getByTitle("新增节点").click();
  await page.waitForTimeout(500);
  await page.getByText("图片", { exact: false }).first().click();
  await page.waitForTimeout(1200);

  // 转储快捷面板 DOM 结构（裁剪版）
  const dom = await page.evaluate(() => {
    const qs = document.querySelector("[class*=quickStart],[class*=quick-start],[class*=composer]");
    if (!qs) return "(no composer root found)";
    const walk = (el, depth) => {
      if (depth > 4) return "";
      const cls = (typeof el.className === "string" ? el.className : "").split(" ").filter((c) => c && !c.startsWith("w-") && !c.startsWith("h-")).join(".").slice(0, 60);
      const txt = el.children.length === 0 ? (el.textContent || "").trim().slice(0, 25) : "";
      let s = `${"  ".repeat(depth)}<${el.tagName.toLowerCase()}${cls ? " ." + cls : ""}> ${txt}\n`;
      for (const c of el.children) s += walk(c, depth + 1);
      return s;
    };
    return walk(qs, 0).slice(0, 3000);
  });
  console.log(dom);

  // 逐个尝试打开：风格 / 技能 / 附件 / @
  const tries = [
    ["12-style", "button:has-text('风格')"],
    ["13-skill", "button[aria-label*='技能'],button[title*='技能']"],
    ["14-attach", "button[aria-label*='附件'],button[aria-label*='素材'],button[title*='素材'],button[aria-label*='参考']"],
    ["15-atmenu", "button:has-text('@')"],
  ];
  for (const [name, sel] of tries) {
    try {
      await page.locator(sel).first().click({ timeout: 3000 });
      await page.waitForTimeout(900);
      await page.screenshot({ path: `${SHOTS}/${name}.png` });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
      console.log(`[ok] ${name}`);
    } catch (e) {
      console.log(`[skip] ${name}`);
    }
  }
  await browser.close();
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
