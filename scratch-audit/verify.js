// verify: 修复后视觉复查（张数弹层/助手避让/技能浅色/风格卡/灯箱/历史/节点下拉）
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

  // v1: 张数弹层（应向上开/portal，不被裁）
  await page.getByTitle("新增节点").click();
  await page.waitForTimeout(600);
  await page.locator("div[role=menu]").getByText("图片", { exact: true }).click();
  await page.waitForTimeout(1500);
  await page.getByTitle("选择图片张数").click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/v1-count.png` });
  console.log("[ok] v1-count");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  // v2: 打开 AI 助手，快捷面板应右缩避让
  await page.getByTitle("AI 小助手").click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${SHOTS}/v2-assistant-avoid.png` });
  console.log("[ok] v2-assistant-avoid");

  // v3: 助手内开技能 → 浅色 SkillPicker
  try {
    await page.locator("button", { hasText: "技能" }).last().click({ timeout: 3000 });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${SHOTS}/v3-skill-light.png` });
    console.log("[ok] v3-skill-light");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  } catch { console.log("[skip] v3"); }

  // 关助手
  await page.getByTitle("AI 小助手").click();
  await page.waitForTimeout(600);

  // v4: 风格弹窗卡片兜底
  await page.locator("button", { hasText: "风格" }).first().click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/v4-style-cards.png` });
  console.log("[ok] v4-style-cards");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  // 关快捷面板
  await page.mouse.click(1300, 600);
  await page.waitForTimeout(500);

  // v5: 节点图片 → 灯箱顶栏
  await page.mouse.click(560, 240);
  await page.waitForTimeout(600);
  // 双击或单击图片区开灯箱？尝试点击图片中心
  await page.mouse.click(560, 240);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/v5-maybe-lightbox.png` });
  console.log("[ok] v5-maybe-lightbox");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  // v6: 历史面板 skeleton + Esc 关闭
  await page.getByTitle("历史记录").click();
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${SHOTS}/v6-history-skeleton.png` });
  await page.waitForTimeout(1200);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}/v6-history-esc.png` });
  const historyClosed = await page.evaluate(() => !document.querySelector("[class*=historyPanel],[class*=history-panel]"));
  console.log("[ok] v6-history, esc closed =", historyClosed);

  await browser.close();
})().catch((e) => { console.error("FATAL", String(e).slice(0, 300)); process.exit(1); });
