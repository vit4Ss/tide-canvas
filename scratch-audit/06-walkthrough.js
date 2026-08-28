// 06: 图标按钮走查（Paperclip/Wand2/AtSign/Clock3）+ 节点下拉 + 右键菜单 + 历史 + 助手
const { chromium } = require("playwright-core");
const TOKEN = process.env.CANVAS_TOKEN;
const SHOTS = __dirname + "/shots";

async function clickIconButton(page, iconCls, shotName) {
  try {
    const btn = page.locator(`svg.${iconCls}`).first().locator("xpath=ancestor::button[1]");
    await btn.click({ timeout: 2500 });
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${SHOTS}/${shotName}.png` });
    console.log(`[ok] ${shotName}`);
    return true;
  } catch {
    console.log(`[skip] ${shotName}`);
    return false;
  }
}

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

  // 附件（Paperclip）→ 应打开素材/参考弹层
  if (await clickIconButton(page, "lucide-paperclip", "16-attach")) await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  // 技能（Wand2）→ 应打开 SkillPicker（弹窗套弹窗）
  if (await clickIconButton(page, "lucide-wand-2", "17-skillpicker")) await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  // @ 引用（AtSign）
  if (await clickIconButton(page, "lucide-at-sign", "18-atmenu")) await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  // 历史（Clock3）
  if (await clickIconButton(page, "lucide-clock-3", "19-history-quick")) await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  // 关闭快捷面板，回到画布
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  // 右键图片节点 → 上下文菜单
  await page.mouse.click(590, 350, { button: "right" });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/20-contextmenu.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  // 历史记录面板
  await page.getByTitle("历史记录").click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/21-history-panel.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  // AI 小助手面板
  await page.getByTitle("AI 小助手").click();
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${SHOTS}/22-assistant.png` });

  await browser.close();
})().catch((e) => { console.error("FATAL", String(e).slice(0, 300)); process.exit(1); });
