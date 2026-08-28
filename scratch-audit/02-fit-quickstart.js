// 02: 适应视图 + 左下角重叠元素识别 + 打开快捷生成面板
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

  // 左下角重叠元素：截取该区域的元素栈
  const stackInfo = await page.evaluate(() => {
    const out = [];
    for (const [x, y] of [[35, 858], [60, 866], [18, 850]]) {
      const stack = document.elementsFromPoint(x, y).slice(0, 5).map((el) => ({
        tag: el.tagName.toLowerCase(),
        cls: (typeof el.className === "string" ? el.className : "").slice(0, 100),
        text: (el.textContent || "").trim().slice(0, 30),
      }));
      out.push({ point: [x, y], stack });
    }
    return out;
  });
  console.log(JSON.stringify(stackInfo, null, 1));

  // 适应视图
  await page.getByTitle("适应视图").click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: SHOTS + "/02-fit-view.png" });

  // 打开「新增节点」快捷面板
  await page.getByTitle("新增节点").click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: SHOTS + "/03-quickstart.png" });

  await browser.close();
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
