// 10: 助手技能弹窗 + 张数弹层 + 模型加载失败诊断
const { chromium } = require("playwright-core");
const TOKEN = process.env.CANVAS_TOKEN;
const SHOTS = __dirname + "/shots";

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, locale: "zh-CN" });
  await ctx.addInitScript((t) => localStorage.setItem("access_token", t), TOKEN);
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });
  page.on("response", (r) => { if (r.status() >= 400 && r.url().includes("/api/")) errors.push(`${r.status()} ${r.url().slice(0, 110)}`); });

  await page.goto("http://localhost:3000/canvas/1ad61fc8a0f11130f870d3960a10abc9", { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.getByTitle("适应视图").waitFor({ state: "visible", timeout: 90000 });
  await page.waitForTimeout(2000);

  // AI 助手 → 技能（SkillPicker 深色弹窗 over 浅色画布）
  await page.getByTitle("AI 小助手").click();
  await page.waitForTimeout(1200);
  try {
    await page.locator("button", { hasText: "技能" }).last().click({ timeout: 3000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${SHOTS}/29-assistant-skill.png` });
    console.log("[ok] 29-assistant-skill");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
  } catch { console.log("[skip] assistant skill"); }

  // 快捷面板 → 张数弹层
  await page.getByTitle("新增节点").click();
  await page.waitForTimeout(600);
  await page.locator("div[role=menu]").getByText("图片", { exact: true }).click();
  await page.waitForTimeout(1500);
  // 模型 pill 文案
  const modelText = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /模型|GPT|Nano|MJ|Midjourney/i.test(x.textContent || "") && x.getBoundingClientRect().y > 600);
    return b ? b.textContent.trim().slice(0, 40) : "(no model pill)";
  });
  console.log("model pill:", modelText);
  try {
    await page.getByTitle("选择图片张数").click({ timeout: 3000 });
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${SHOTS}/24-count-popover.png` });
    console.log("[ok] 24-count-popover");
  } catch { console.log("[skip] count"); }

  console.log("--- console/api errors ---");
  errors.slice(0, 15).forEach((e) => console.log(e));
  await browser.close();
})().catch((e) => { console.error("FATAL", String(e).slice(0, 300)); process.exit(1); });
