// 04: 快捷面板下拉框逐个打开截图
const { chromium } = require("playwright-core");
const TOKEN = process.env.CANVAS_TOKEN;
const SHOTS = __dirname + "/shots";

async function shotOpen(page, name, locator, wait = 900) {
  try {
    await locator.first().click({ timeout: 4000 });
    await page.waitForTimeout(wait);
    await page.screenshot({ path: `${SHOTS}/${name}.png` });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    return true;
  } catch (e) {
    console.log(`[skip] ${name}: ${String(e).slice(0, 120)}`);
    return false;
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, locale: "zh-CN" });
  await ctx.addInitScript((t) => localStorage.setItem("access_token", t), TOKEN);
  const page = await ctx.newPage();
  await page.goto("http://localhost:3000/canvas/1ad61fc8a0f11130f870d3960a10abc9", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(10000);

  await page.getByTitle("适应视图").click();
  await page.waitForTimeout(600);
  await page.getByTitle("新增节点").click();
  await page.waitForTimeout(600);
  await page.getByText("图片", { exact: false }).first().click();
  await page.waitForTimeout(1200);

  // 模型下拉
  await shotOpen(page, "05-dd-model", page.locator("button", { hasText: /GPT|模型/ }).last());
  // 比例下拉（16:9 之类）
  await shotOpen(page, "06-dd-ratio", page.locator("button,select", { hasText: /16:9|1:1|9:16/ }).first());
  // 画质下拉
  await shotOpen(page, "07-dd-quality", page.locator("button", { hasText: /画质|2K|高清|标清/ }).first());
  // 数量下拉
  await shotOpen(page, "08-dd-count", page.locator("button", { hasText: /^\s*\d+\s*张\s*$/ }).first());
  // 风格 chip
  await shotOpen(page, "09-style", page.locator("button,[role=button]", { hasText: /^风格$/ }).first());
  // 技能（Wand2 图标按钮，aria 可能是 技能）
  await shotOpen(page, "10-skill", page.locator("button[aria-label*=技能], button[title*=技能]").first());
  // 参考素材（Paperclip 附件按钮）
  await shotOpen(page, "11-attach", page.locator("button[aria-label*=附件], button[aria-label*=参考], button[title*=参考], button[title*=上传]").first());

  await browser.close();
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
