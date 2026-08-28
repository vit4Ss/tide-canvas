// 11: 人像面板（表情/妆容）首次打开 UI 异常复现——截图 + 计算样式诊断
const { chromium } = require("playwright-core");
const SHOTS = __dirname + "/shots";
const IMG = "D:/mbfczzzz/claude/canvas/tide-canvas-web/public/assets/canvas/makeup-presets-v1.png";

async function getToken() {
  const res = await fetch("http://localhost:8080/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ account: "uiaudit01", password: "Audit123456" }),
  });
  const json = await res.json();
  if (!json?.data?.accessToken) throw new Error("login failed: " + JSON.stringify(json).slice(0, 200));
  return json.data.accessToken;
}

async function openCanvas(page) {
  await page.goto("http://localhost:3000/canvas/new", { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.getByTitle("适应视图").waitFor({ state: "visible", timeout: 90000 });
  await page.waitForTimeout(1500);
}

async function addImageNodeWithPicture(page) {
  await page.getByTitle("新增节点").click();
  await page.waitForTimeout(600);
  await page.locator("div[role=menu]").getByText("图片", { exact: true }).click();
  await page.waitForTimeout(1200);
  const input = page.locator('input[type=file][accept="image/*"]').first();
  await input.setInputFiles(IMG);
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${SHOTS}/p0-after-upload.png` });
  const state = await page.evaluate(() => ({
    imgs: document.querySelectorAll("img").length,
    toolbarTexts: Array.from(document.querySelectorAll("button")).map((b) => b.textContent?.trim()).filter((t) => t && /妆容|表情|质感/.test(t)),
  }));
  console.log("after upload:", JSON.stringify(state));
}

async function openPortraitPanel(page, name) {
  // 每次打开前面板入口都在工具栏「…」溢出菜单里；aux UI 依赖节点 hover，先悬停节点
  const nodeImg = page.locator("img").first();
  await nodeImg.hover();
  await page.waitForTimeout(300);
  const moreBtn = page.getByTitle("更多功能", { exact: true }).first();
  await moreBtn.click();
  await page.waitForTimeout(500);
  const dump = await page.evaluate(() => Array.from(document.querySelectorAll("[data-toolbar-overflow] button, [role=group] button"))
    .map((b) => b.textContent?.trim()).filter(Boolean));
  console.log("overflow menu items:", JSON.stringify(dump));
  // 用 DOM click 触发，避免合成鼠标事件触发画布的取消选中逻辑
  await page.evaluate((label) => {
    const btns = Array.from(document.querySelectorAll("[data-toolbar-overflow] button"));
    const b = btns.find((x) => x.textContent?.trim() === label);
    if (b) b.click();
  }, name);
  await page.waitForTimeout(150);
  const after = await page.evaluate(() => ({
    overflowStillOpen: !!document.querySelector("[data-toolbar-overflow]"),
    dialogs: Array.from(document.querySelectorAll("[role=dialog]")).map((d) => d.getAttribute("aria-label")),
    textMatches: Array.from(document.querySelectorAll("button")).filter((b) => b.textContent?.trim() === "表情调节").length,
  }));
  console.log("after click:", JSON.stringify(after));
}

async function diagnostics(page, tag) {
  return page.evaluate(() => {
    const panel = document.querySelector('[role=dialog][aria-label="表情调节"], [role=dialog][aria-label="妆容调节"]');
    if (!panel) return { panel: false };
    const img = panel.querySelector("img");
    const cs = getComputedStyle(panel);
    const ics = img ? getComputedStyle(img) : null;
    // 探测关键工具类是否生效：创建一个应用该类的临时元素看计算值
    const probe = (cls, prop) => {
      const el = document.createElement("div");
      el.className = cls;
      el.style.position = "absolute";
      el.style.visibility = "hidden";
      document.body.appendChild(el);
      const v = getComputedStyle(el)[prop];
      el.remove();
      return v;
    };
    return {
      panel: true,
      panelBorderRadius: cs.borderRadius,
      panelWidth: cs.width,
      panelDisplay: cs.display,
      imgWidth: ics?.width,
      imgHeight: ics?.height,
      imgMaxWidth: ics?.maxWidth,
      imgTransform: ics?.transform,
      probe_h500: probe("h-[500%]", "height"),
      probe_rounded22: probe("rounded-[22px]", "borderRadius"),
      probe_text10: probe("text-[10px]", "fontSize"),
      styleSheetCount: document.styleSheets.length,
      sheets: Array.from(document.styleSheets).map((s) => (s.href || "inline").split("/").slice(-1)[0].slice(0, 60)),
    };
  });
}

(async () => {
  const token = await getToken();
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, locale: "zh-CN" });
  await ctx.addInitScript((t) => localStorage.setItem("access_token", t), token);
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") console.log("[console.error]", m.text().slice(0, 200)); });
  page.on("requestfailed", (r) => console.log("[reqfail]", r.url().slice(-80), r.failure()?.errorText));
  page.on("response", (r) => { if (r.status() >= 400) console.log("[http", r.status() + "]", r.url().slice(-120)); });

  // 本地网络到不了测试 OSS：PUT 假装成功，GET 回本地 PNG
  const fs = require("fs");
  const png = fs.readFileSync(IMG);
  await page.route("**aliyuncs.com/**", (route) => {
    const req = route.request();
    if (req.method() === "PUT" || req.method() === "POST") {
      return route.fulfill({ status: 200, body: "" });
    }
    return route.fulfill({ status: 200, contentType: "image/png", body: png });
  });
  // 后端 image 节点配置缺三个人像特性，本地注入（不改服务端配置）
  await page.route("**/api/canvas/node-types", async (route) => {
    const resp = await route.fetch();
    const json = await resp.json();
    const nts = json?.data?.nodeTypes ?? [];
    for (const nt of nts) {
      if (nt.key === "image" && Array.isArray(nt.features)) {
        for (const f of ["image.makeupAdjust", "image.expressionAdjust", "image.portraitTexture"]) {
          if (!nt.features.includes(f)) nt.features.push(f);
        }
      }
    }
    return route.fulfill({ response: resp, json });
  });
  await page.route("**/api/files/register", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true, code: 200, message: "success", timestamp: Date.now(),
        data: {
          id: "999000111", originalName: "audit.png",
          fileUrl: "http://localhost:3000/assets/canvas/makeup-presets-v1.png",
          fileSize: png.length, fileType: "image", category: "general",
          mimeType: "image/png", storageType: "local", createTime: new Date().toISOString(),
        },
      }),
    }),
  );

  // ===== 第一次进画布（冷缓存） =====
  await openCanvas(page);
  console.log("canvas url:", page.url());
  await addImageNodeWithPicture(page);
  await page.screenshot({ path: `${SHOTS}/p1-node-with-image.png` });

  // 打开表情调节面板，立刻截图 + 诊断
  await openPortraitPanel(page, "表情调节");
  await page.waitForTimeout(80);
  await page.screenshot({ path: `${SHOTS}/p2-expression-first-80ms.png` });
  console.log("diag@80ms:", JSON.stringify(await diagnostics(page), null, 1));
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${SHOTS}/p3-expression-first-1s.png` });
  console.log("diag@1.3s:", JSON.stringify(await diagnostics(page), null, 1));

  // 关掉再开妆容面板
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  await openPortraitPanel(page, "妆容调节");
  await page.waitForTimeout(80);
  await page.screenshot({ path: `${SHOTS}/p4-makeup-first-80ms.png` });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${SHOTS}/p5-makeup-first-1s.png` });

  // ===== 刷新后再开 =====
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTitle("适应视图").waitFor({ state: "visible", timeout: 90000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${SHOTS}/p5b-after-reload-canvas.png` });
  await openPortraitPanel(page, "表情调节");
  await page.waitForTimeout(80);
  await page.screenshot({ path: `${SHOTS}/p6-expression-after-reload.png` });
  console.log("diag@reload:", JSON.stringify(await diagnostics(page), null, 1));

  await browser.close();
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
