import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile, readFile } from "node:fs/promises";
const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_MODULE || "playwright-core",
);
const base = process.env.FRONTEND_TEST_URL || "http://127.0.0.1:3319";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_PATH
    ? { executablePath: process.env.BROWSER_PATH }
    : { channel: "chrome" }),
});
// Use the same original artwork and recipes that are installed by the backend.
const catalog = JSON.parse(
  await readFile(
    new URL(
      "../../tide-canvas-server/internal/handler/studiotemplate/samples.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
let templates = catalog.map(({ template }, i) => ({
  ...template,
  id: String(i + 1),
  uses: 0,
  // Motion behavior is tested with an isolated fixture. Production storyboard
  // samples stay drafts until a real clip is uploaded by an operator.
  ...(template.mediaType === "video"
    ? {
        status: 1,
        previewUrl: base + "/fixture-video.mp4",
        mode: "ref",
        requirements: { images: 0, videos: 1, audio: 1 },
      }
    : {}),
}));
const samplePrompts = templates.map((row) => row.prompt);
const imgModel = {
  id: "101",
  name: "GPT Image 2",
  modelKey: "gpt-image-test",
  type: "image",
  pointCost: "4",
  config: {
    modes: ["t2i", "i2i"],
    ratios: ["1:1", "16:9"],
    resolutions: ["1k", "2k"],
    qualities: ["standard", "high"],
    creditCost: 4,
  },
};
templates[0].options = { resolution: "2K", quality: "HIGH" };
const vidModel = {
  id: "102",
  name: "Video Test",
  modelKey: "video-test",
  type: "video",
  pointCost: "10",
  config: {
    modes: ["t2v", "i2v", "omni_ref"],
    ratios: ["16:9"],
    resolutions: ["1080p"],
    durations: ["5s"],
    creditCost: 10,
    omniRefVideoEnabled: true,
    omniRefAudioEnabled: true,
  },
};
await mkdir(".runtime/studio-templates-review", { recursive: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1500, height: 1000 },
  });
  await context.addInitScript(() =>
    localStorage.setItem("access_token", "studio-template-fixture"),
  );
  let allowGeneration = false,
    uploaded = 0,
    generatedTask = null;
  const mutations = [],
    errors = [];
  await context.route("**/fixture-video.mp4", (r) =>
    r.fulfill({ status: 404, body: "fixture video unavailable" }),
  );
  await context.route("**/api/**", async (route) => {
    const req = route.request(),
      u = new URL(req.url()),
      path = u.pathname;
    if (req.method() !== "GET") mutations.push({ path, body: req.postData() });
    let data = {};
    if (path === "/api/auth/me")
      data = {
        id: "801",
        username: "reviewer",
        nickname: "Reviewer",
        role: 9,
        status: 1,
        points: 1000,
        menus: [],
        adminPerms: [],
      };
    else if (path === "/api/market/studio-models")
      data = u.searchParams.get("type") === "video" ? [vidModel] : [imgModel];
    else if (path === "/api/points/balance") data = { points: 1000, frozen: 0 };
    else if (path === "/api/ai/optimize-cost") data = { cost: 0 };
    else if (path === "/api/files/presign") data = { direct: false };
    else if (path === "/api/files/upload") {
      uploaded++;
      data = {
        id: String(600 + uploaded),
        fileUrl: base + `/avatars/${uploaded === 1 ? "cat" : "fox"}.png`,
        fileType: "image",
        originalName: `reference-${uploaded}.png`,
        fileSize: 123456,
      };
    } else if (path === "/api/ai/tasks/5001") data = generatedTask;
    else if (path === "/api/ai/tasks" || path === "/api/ai/history")
      data = { records: [], total: 0, pages: 1, pageNum: 1, pageSize: 20 };
    else if (path.endsWith("unread-count")) data = { count: 0 };
    else if (path.includes("notifications")) data = { records: [], total: 0 };
    else if (path === "/api/ai/tools") data = [];
    else if (path === "/api/admin/studio-templates/sources")
      data = {
        records: [
          {
            id: "9001",
            userId: "801",
            mediaType: "image",
            prompt: "我的创作提示词",
            model: "GPT Image 2",
            resultUrl: "/assets/canvas/expression-preview-v1.webp",
            createTime: "2026-10-19 12:00:00",
          },
        ],
        total: 1,
        pages: 1,
        pageNum: 1,
        pageSize: 18,
      };
    else if (path === "/api/admin/studio-templates/from-task") {
      data = {
        ...templates[4],
        id: "9002",
        status: 0,
        title: "新的创作灵感",
        prompt: "我的创作提示词",
      };
      templates.push(data);
    } else if (
      path === "/api/studio-templates" ||
      path === "/api/admin/studio-templates"
    ) {
      if (req.method() === "POST") {
        data = { ...JSON.parse(req.postData()), id: "10001", uses: 0 };
        templates.push(data);
      } else {
        const filtered = templates.filter(
          (t) =>
            (!u.searchParams.get("kind") ||
              t.kind === u.searchParams.get("kind")) &&
            (!u.searchParams.get("mediaType") ||
              t.mediaType === u.searchParams.get("mediaType")) &&
            (path.includes("admin") || t.status === 1) &&
            (!u.searchParams.get("category") ||
              t.category === u.searchParams.get("category")) &&
            (!u.searchParams.get("keyword") ||
              t.title.includes(u.searchParams.get("keyword"))),
        );
        data = {
          records: filtered,
          total: filtered.length,
          pages: 1,
          pageNum: 1,
          pageSize: 24,
          categories: [...new Set(filtered.map((t) => t.category))],
        };
      }
    } else if (/^\/api\/studio-templates\/\d+$/.test(path))
      data = templates.find((t) => t.id === path.split("/").at(-1));
    else if (
      /^\/api\/admin\/studio-templates\/\d+$/.test(path) &&
      req.method() === "PUT"
    ) {
      data = {
        ...JSON.parse(req.postData()),
        id: path.split("/").at(-1),
        uses: 0,
      };
      templates = templates.map((t) => (t.id === data.id ? data : t));
    } else if (path.endsWith("/use")) data = { ok: true };
    else if (path === "/api/ai/generate") {
      assert.equal(
        allowGeneration,
        true,
        "unexpected paid generation without required references",
      );
      const submitted = JSON.parse(req.postData());
      generatedTask = {
        id: "5001",
        userId: "801",
        handler: "image_to_image",
        modelName: "gpt-image-test",
        status: 1,
        progress: 100,
        resultUrl: base + "/avatars/cat.png",
        resultMeta: "{}",
        input: JSON.stringify(submitted.input),
        createTime: new Date().toISOString(),
        pointCost: 4,
      };
      data = generatedTask;
    }
    await route.fulfill({ json: { success: true, code: 200, data } });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base + "/studio", { waitUntil: "networkidle" });
  await page
    .getByRole("button", { name: "查看黏土奇遇", exact: true })
    .waitFor();
  await page.screenshot({
    path: ".runtime/studio-templates-review/styles-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  const prompt = page
    .locator('[contenteditable="true"][role="textbox"]')
    .first();
  await prompt.fill("一只骑自行车的小猫");
  await page
    .getByRole("button", { name: "查看黏土奇遇", exact: true })
    .locator("..")
    .getByRole("button", { name: "使用风格", exact: true })
    .click();
  await page.getByText("已选风格主题", { exact: true }).waitFor();
  assert.equal(
    await prompt.innerText(),
    samplePrompts[0] + "\n\n一只骑自行车的小猫",
  );
  await page.waitForFunction(
    () => !document.querySelector('[class*="flight"]'),
  );
  await page
    .getByRole("button", { name: "查看纸艺山海", exact: true })
    .locator("..")
    .getByRole("button", { name: "使用风格", exact: true })
    .click();
  await page.waitForFunction(
    (prefix) =>
      document
        .querySelector('[contenteditable="true"]')
        .innerText.startsWith(prefix),
    samplePrompts[1],
  );
  assert.equal(
    await prompt.innerText(),
    samplePrompts[1] + "\n\n一只骑自行车的小猫",
  );
  await page.getByRole("tab", { name: "灵感做同款" }).click();
  await page
    .getByRole("button", { name: "查看星光秀场换装", exact: true })
    .waitFor();
  const firstTile = await page
    .getByRole("button", { name: "查看星光秀场换装", exact: true })
    .boundingBox();
  const secondTile = await page
    .getByRole("button", { name: "查看潮汐产品大片", exact: true })
    .boundingBox();
  assert.ok(
    secondTile.x > firstTile.x + 100,
    "inspiration cards pile into one column",
  );
  await page
    .getByRole("button", { name: "查看星光秀场换装", exact: true })
    .click();
  const detail = page.getByRole("dialog", { name: "星光秀场换装" });
  await detail.getByText("你需要准备", { exact: true }).waitFor();
  const contrast = await detail
    .getByRole("button", { name: "用我的素材做同款" })
    .evaluate((el) => {
      const style = getComputedStyle(el);
      const rgb = (s) => (s.match(/[\d.]+/g) || []).map(Number);
      const fg = rgb(style.color),
        bg = rgb(style.backgroundColor);
      const luminance = (c) =>
        c
          .slice(0, 3)
          .map((n) => n / 255)
          .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4))
          .reduce((s, n, i) => s + n * [0.2126, 0.7152, 0.0722][i], 0);
      const a = luminance(fg),
        b = luminance(bg);
      return {
        alpha: fg[3] ?? 1,
        ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
      };
    });
  assert.ok(
    contrast.alpha > 0.99 && contrast.ratio >= 4.5,
    "detail action text has insufficient contrast",
  );
  const mask = await detail.locator("..").boundingBox();
  assert.equal(mask.x, 0, "detail is trapped inside the catalog container");
  assert.equal(mask.width, 1500);
  await page.screenshot({
    path: ".runtime/studio-templates-review/inspiration-detail.png",
    fullPage: true,
    animations: "disabled",
  });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const action = await detail
      .getByRole("button", { name: "用我的素材做同款" })
      .boundingBox();
    assert.ok(
      action.x >= 0 &&
        action.x + action.width <= width &&
        action.y + action.height <= 844,
      `detail primary action clipped at ${width}`,
    );
    assert.equal(
      await detail.evaluate((el) => el.scrollWidth > el.clientWidth + 1),
      false,
      `detail content overflow ${width}`,
    );
    if (width === 390)
      await page.screenshot({
        path: ".runtime/studio-templates-review/detail-mobile.png",
        fullPage: true,
        animations: "disabled",
      });
  }
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.setViewportSize({ width: 1024, height: 420 });
  const shortAction = await detail
    .getByRole("button", { name: "用我的素材做同款" })
    .boundingBox();
  assert.ok(
    shortAction.y >= 0 && shortAction.y + shortAction.height <= 420,
    "detail action clipped in short landscape window",
  );
  await page.setViewportSize({ width: 1500, height: 1000 });
  await detail.getByRole("button", { name: "用我的素材做同款" }).click();
  const confirmation = page.getByRole("alertdialog", { name: "应用创作模板" });
  await confirmation.getByRole("button", { name: "取消", exact: true }).focus();
  await page.keyboard.press("Tab");
  assert.equal(
    await confirmation
      .getByRole("button", { name: "应用模板", exact: true })
      .evaluate((el) => el === document.activeElement),
    true,
    "nested dialog stole keyboard focus",
  );
  await page.keyboard.press("Escape");
  assert.equal(
    await prompt.innerText(),
    samplePrompts[1] + "\n\n一只骑自行车的小猫",
    "cancelled replacement changed input",
  );
  await detail.getByRole("button", { name: "用我的素材做同款" }).click();
  await page.getByRole("button", { name: "应用模板", exact: true }).click();
  await page.waitForFunction(
    (prefix) =>
      document
        .querySelector('[contenteditable="true"]')
        .innerText.startsWith(prefix),
    samplePrompts[4].slice(0, 30),
  );
  await page.locator("#gen").click();
  await page.getByText(/需要上传至少 2 张图片/).waitFor();
  assert.equal(
    mutations.filter((r) => r.path === "/api/ai/generate").length,
    0,
  );
  await page.screenshot({
    path: ".runtime/studio-templates-review/inspiration-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  // Exercise the real upload/submit UI against isolated mocked endpoints. The
  // selected template's preview must never be sent as a user's reference.
  await page
    .locator("#dropFiles")
    .getByRole("button", { name: /上传/ })
    .first()
    .click();
  const fileChooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /本地上传/ }).click();
  await (
    await fileChooser
  ).setFiles(["public/avatars/cat.png", "public/avatars/fox.png"]);
  await page.locator("#dropFiles .ws-ref:not(.uploading)").nth(1).waitFor();
  await page.locator("#dropFiles").getByText("2/4", { exact: true }).waitFor();
  allowGeneration = true;
  const submit = page.waitForRequest(
    (r) => new URL(r.url()).pathname === "/api/ai/generate",
  );
  await page.locator("#gen").click();
  const payload = JSON.parse((await submit).postData());
  assert.equal(payload.input.prompt, samplePrompts[4]);
  assert.deepEqual(payload.input.imageList, [
    base + "/avatars/cat.png",
    base + "/avatars/fox.png",
  ]);
  assert.equal(payload.input.resolution, "2k");
  assert.equal(payload.input.quality, "high");
  await page.screenshot({
    path: ".runtime/studio-templates-review/submitted-history.png",
    fullPage: true,
    animations: "disabled",
  });
  await writeFile(
    ".runtime/studio-templates-review/history-layout.json",
    JSON.stringify(
      await page.evaluate(() =>
        [
          ...document.querySelectorAll(
            '.ws-stage,.ws-stage-main,[class*="workspace"],[class*="cols"]',
          ),
        ].map((el) => ({
          cls: el.className,
          rect: el.getBoundingClientRect().toJSON(),
          display: getComputedStyle(el).display,
          flex: getComputedStyle(el).flex,
          height: getComputedStyle(el).height,
        })),
      ),
      null,
      2,
    ),
  );
  await page.locator(".ws-stage").waitFor();
  assert.ok(
    (await page.locator(".ws-stage").boundingBox()).height > 500,
    "history stage collapsed after adding template tabs",
  );
  await page
    .locator(".ws-stage")
    .getByRole("button", { name: "编辑", exact: true })
    .first()
    .click();
  await page.locator("#gen:not([disabled])").waitFor();
  // Reference pills introduce visual line breaks / caret sentinels in innerText.
  assert.equal(
    (await prompt.innerText()).replace(/[\n\u200b]/g, ""),
    samplePrompts[4],
  );
  assert.equal(
    await page.locator("#dropFiles .ws-ref:not(.uploading)").count(),
    2,
  );
  assert.equal(
    mutations.filter((r) => r.path === "/api/ai/generate").length,
    1,
  );
  allowGeneration = false;
  await page
    .locator("#type-tabs")
    .getByRole("button", { name: "视频", exact: true })
    .click();
  await page.getByRole("tab", { name: "风格主题" }).click();
  await page.getByRole("button", { name: "查看高速追光" }).waitFor();
  assert.equal(await page.locator("article video").count(), 0);
  await prompt.fill("");
  await page
    .getByRole("button", { name: "查看高速追光" })
    .locator("..")
    .getByRole("button", { name: "使用风格", exact: true })
    .click();
  await page.getByText("正在做同款", { exact: true }).count();
  await page.getByText("已选风格主题", { exact: true }).waitFor();
  await page.locator("#gen").click();
  await page.getByText(/需要上传至少 1 段视频、1 段音频/).waitFor();
  await page.screenshot({
    path: ".runtime/studio-templates-review/video-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  for (const width of [1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    );
    if (overflow) {
      await page.screenshot({
        path: `.runtime/studio-templates-review/overflow-${width}.png`,
        fullPage: true,
        animations: "disabled",
      });
      await writeFile(
        ".runtime/studio-templates-review/overflow.json",
        JSON.stringify(
          await page.evaluate(() =>
            [...document.querySelectorAll("body *")]
              .map((e) => ({
                tag: e.tagName,
                cls: e.className,
                rect: {
                  left: e.getBoundingClientRect().left,
                  right: e.getBoundingClientRect().right,
                  width: e.getBoundingClientRect().width,
                },
              }))
              .filter((e) => e.rect.right > innerWidth + 1 && e.rect.width > 0)
              .slice(0, 20),
          ),
          null,
          2,
        ),
      );
    }
    assert.equal(overflow, false, `studio overflow ${width}`);
  }
  await page.screenshot({
    path: ".runtime/studio-templates-review/video-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1500, height: 1000 });
  const search = page.getByRole("textbox", { name: "搜索创作模板" });
  await search.fill("no-matching-template");
  await page.getByText("没有找到匹配的模板", { exact: true }).waitFor();
  await page.getByRole("button", { name: "清除筛选", exact: true }).click();
  await page.getByRole("button", { name: "查看高速追光" }).waitFor();
  await page.goto(base + "/admin/studio-templates", {
    waitUntil: "networkidle",
  });
  await page.screenshot({
    path: ".runtime/studio-templates-review/admin-catalog.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "新建风格", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "新建创作模板" });
  await editor.getByText("用户看到的预览", { exact: true }).waitFor();
  await editor.getByLabel(/^名称/).fill("运营测试风格");
  await editor.getByLabel(/完整提示词/).fill("a professionally composed image");
  await page.screenshot({
    path: ".runtime/studio-templates-review/admin-editor.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await editor.evaluate((el) => el.scrollWidth > el.clientWidth + 1),
    false,
    "admin editor overflows mobile",
  );
  await page.screenshot({
    path: ".runtime/studio-templates-review/admin-editor-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1500, height: 1000 });
  await editor.getByRole("button", { name: "保存草稿", exact: true }).click();
  await page
    .getByRole("heading", { name: "运营测试风格", exact: true })
    .waitFor();
  const create = mutations.find(
    (r) => r.path === "/api/admin/studio-templates",
  );
  assert.equal(JSON.parse(create.body).status, 0);
  await page
    .getByRole("button", { name: "从用户作品导入", exact: true })
    .click();
  await page
    .getByRole("button", { name: "导入为灵感草稿", exact: true })
    .click();
  const imported = page.getByRole("dialog", { name: "编辑创作模板" });
  await imported.getByLabel(/完整提示词/).waitFor();
  assert.equal(
    await imported.getByLabel(/完整提示词/).inputValue(),
    "我的创作提示词",
  );
  assert.equal(
    mutations.filter((r) => r.path.includes("/api/ai/generate")).length,
    1,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: style composition, keyboard confirmation/cancel, image/video preflight, exact canonical submit options and owned references, history, fly-in cleanup, mobile layout, admin draft save and private-source import.",
  );
} finally {
  await browser.close();
}
