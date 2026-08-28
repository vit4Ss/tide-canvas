// 09: 参数弹层/张数弹层/节点选中/右键/历史/助手 收官走查
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

  // 1) 参数弹层
  await page.getByTitle("选择图片参数").click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/23-param-popover.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  // 2) 张数弹层
  await page.getByTitle("选择图片张数").click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/24-count-popover.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  // 3) 关闭快捷面板（点空白画布）
  await page.mouse.click(1300, 700);
  await page.waitForTimeout(600);

  // 4) 单击北极人图片节点（选中/看参数面板）
  await page.mouse.click(560, 240);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/25-node-selected.png` });

  // 5) 右键该节点
  await page.mouse.click(560, 240, { button: "right" });
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${SHOTS}/26-contextmenu.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  // 6) 历史记录
  await page.getByTitle("历史记录").click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/27-history.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  // 7) AI 小助手 + 面板按钮转储
  await page.getByTitle("AI 小助手").click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${SHOTS}/28-assistant.png` });
  const panel = await page.evaluate(() => {
    const els = [...document.querySelectorAll("button")].filter((b) => {
      const r = b.getBoundingClientRect();
      return r.width > 0 && r.x > 1150 && r.y < 850;
    });
    return els.map((b) => ({ t: (b.textContent || "").trim().slice(0, 25), title: b.getAttribute("title"), aria: b.getAttribute("aria-label") }));
  });
  console.log("assistant panel buttons:", JSON.stringify(panel));

  await browser.close();
})().catch((e) => { console.error("FATAL", String(e).slice(0, 300)); process.exit(1); });
