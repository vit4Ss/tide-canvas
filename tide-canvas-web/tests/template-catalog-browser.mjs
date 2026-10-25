import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile } from "node:fs/promises";

const { chromium } = createRequire(import.meta.url)(
  process.env.PLAYWRIGHT_MODULE || "playwright-core",
);
const base = process.env.FRONTEND_TEST_URL || "http://127.0.0.1:3319";
const dir = ".runtime/template-catalog-review";
await mkdir(dir, { recursive: true });
const rows = [];
for (const pack of ["store-food-v002", "groupbuy-promo-v2"]) {
  const source = JSON.parse(await readFile(
    new URL("../../tide-canvas-server/internal/handler/studiotemplate/content-packs/" + pack + "/catalog.json", import.meta.url),
    "utf8",
  ));
  for (const { template } of source.entries) {
    rows.push({ ...template, id: String(30000 + rows.length), uses: 0 });
  }
}
const browser = await chromium.launch({
  headless: true,
  ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : { channel: "chrome" }),
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addInitScript(() => localStorage.setItem("access_token", "template-catalog-fixture"));
let failList = false, failCheck = false, generationRequests = 0, limitRows = 0;
let holdDelete = null, releaseDelete = () => {};
const queries = [], errors = [];
await context.route("**/api/**", async (route) => {
  const request = route.request();
  const url = new URL(request.url()), path = url.pathname;
  let data = {};
  const fail = (message) => route.fulfill({ status: 503, json: { success: false, code: 503, message } });
  if (path === "/api/auth/me") {
    data = { id: "801", username: "operator", nickname: "Operator", role: 9, status: 1, points: 1000, adminPerms: [], menus: ["studio", "assets"] };
  } else if (path === "/api/admin/studio-templates") {
    if (request.method() === "POST") {
      data = { ...request.postDataJSON(), id: "41000", uses: 0 };
      rows.push(data);
      return route.fulfill({ json: { success: true, code: 200, data } });
    }
    queries.push(Object.fromEntries(url.searchParams));
    if (failList) return fail("模拟分类列表读取失败");
    const catalog = [...rows].sort((a, b) => a.sortOrder - b.sortOrder || Number(b.id) - Number(a.id));
    let matches = (limitRows ? catalog.slice(0, limitRows) : catalog).filter(row =>
      (!url.searchParams.get("kind") || row.kind === url.searchParams.get("kind"))
      && (!url.searchParams.get("mediaType") || row.mediaType === url.searchParams.get("mediaType"))
      && (!url.searchParams.get("status") || String(row.status) === url.searchParams.get("status")),
    );
    const categories = [...new Set(matches.map(row => row.category))].sort();
    matches = matches.filter(row =>
      (!url.searchParams.get("category") || row.category === url.searchParams.get("category"))
      && (!url.searchParams.get("keyword") || (row.title + row.description).includes(url.searchParams.get("keyword"))),
    );
    const pageNum = Number(url.searchParams.get("pageNum") || 1);
    const pageSize = Number(url.searchParams.get("pageSize") || 18);
    data = { records: matches.slice((pageNum - 1) * pageSize, pageNum * pageSize), total: matches.length, categories, pages: Math.ceil(matches.length / pageSize), pageNum, pageSize };
  } else if (/^\/api\/admin\/studio-templates\/\d+$/.test(path) && request.method() === "DELETE") {
    if (holdDelete) await holdDelete;
    const index = rows.findIndex(row => row.id === path.split("/").at(-1));
    assert.ok(index >= 0);
    rows.splice(index, 1);
    if (limitRows) limitRows--;
  } else if (path === "/api/admin/studio-templates/check") {
    if (failCheck) return fail("模拟：原模型暂不可用");
    data = { modelId: "video-fixture", modelName: "视频参考模型", handler: "reference_to_video", basePointCost: 7, options: { duration: 30, aspectRatio: "9:16", resolution: "1080p" }, maxUploadBytes: { image: 52428800, video: 52428800, audio: 52428800 } };
  } else if (path === "/api/market/studio-models") {
    data = [{ id: "41", modelKey: "video-fixture", name: "视频参考模型", type: "video", config: { modes: ["omni_ref"], ratios: ["9:16"], durations: ["30s"], resolutions: ["1080p"] } }];
  } else if (path === "/api/ai/models") {
    data = [{ id: "42", modelId: "cover-fixture", name: "封面图片模型", type: "image", pointCost: 7, config: JSON.stringify({ modes: ["t2i"], ratios: ["16:9"], resolutions: ["2k"] }) }];
  } else if (path === "/api/ai/generate") {
    generationRequests++;
    return fail("本测试不得触发收费生成");
  } else if (path === "/api/points/balance") {
    data = { points: 1000, frozen: 0 };
  } else if (path.includes("notifications")) {
    data = path.endsWith("unread-count") ? { count: 0 } : { records: [], total: 0 };
  }
  await route.fulfill({ json: { success: true, code: 200, data } });
});
const page = await context.newPage();
page.on("pageerror", error => errors.push(error.message));
const cards = page.locator(".adm-content article");
const pager = page.getByRole("navigation", { name: "模板分页", exact: true });
const waitForCards = (count) => page.waitForFunction(n => document.querySelectorAll(".adm-content article").length === n, count);
const category = async (name) => {
  await page.getByRole("button", { name: "模板分类", exact: true }).click();
  const list = page.getByRole("listbox", { name: "模板分类", exact: true });
  assert.equal(await list.evaluate(el => getComputedStyle(el).backgroundColor), "rgb(255, 255, 255)");
  await list.getByRole("option", { name, exact: true }).click();
};
try {
  await page.goto(base + "/admin/studio-templates", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /^灵感做同款/ }).click();
  await page.getByRole("button", { name: "视频", exact: true }).click();
  await waitForCards(18);
  await pager.getByText("1 / 4", { exact: true }).waitFor();
  assert.equal(await cards.locator("video").count(), 0, "draft list starts loading videos");
  assert.equal(await cards.locator("img").count(), 0, "draft list invents cover images");
  const cover = cards.first().getByRole("button", { name: /制作封面$/ });
  assert.ok((await cover.boundingBox()).height < 120, "missing cover still occupies a large poster");
  await pager.getByRole("button", { name: "下一页", exact: true }).click();
  await pager.getByText("2 / 4", { exact: true }).waitFor();
  await category("美食团购");
  await waitForCards(12);
  await pager.getByText("1 / 1", { exact: true }).waitFor();
  assert.equal(queries.at(-1).pageNum, "1", "category did not reset page");
  assert.equal(queries.at(-1).category, "美食团购");
  assert.ok((await cards.allTextContents()).every(text => text.includes("美食团购")));
  const beforeActiveClicks = queries.length;
  await page.getByRole("button", { name: "视频", exact: true }).click();
  await page.getByRole("button", { name: /^灵感做同款/ }).click();
  assert.ok((await page.getByRole("button", { name: "模板分类", exact: true }).innerText()).includes("美食团购"), "clicking an active tab cleared the category");
  assert.equal(queries.length, beforeActiveClicks, "clicking an active tab unnecessarily reloaded the list");
  for (const width of [1440, 1024, 768, 480, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "catalog overflow at " + width);
    for (const card of await cards.all()) {
      assert.equal(await card.evaluate(el => el.scrollWidth > el.clientWidth + 1), false, "card overflow at " + width);
    }
    if (width === 1440 || width === 390) {
      await page.screenshot({ path: dir + "/catalog-" + width + ".png", fullPage: true });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  const target = rows.find(row => row.title.startsWith("F01 "));
  await page.getByRole("button", { name: "为" + target.title + "制作封面", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "编辑创作模板", exact: true });
  await editor.getByRole("region", { name: "AI 生成模板封面", exact: true }).waitFor();
  assert.equal(generationRequests, 0, "opening cover editor generated a paid image");
  await editor.getByRole("button", { name: "收起 AI 生成封面", exact: true }).click();
  assert.equal(await editor.getByLabel(/^名称/).inputValue(), target.title);
  assert.ok((await editor.getByLabel(/完整提示词/).inputValue()).trim() === target.prompt.trim(), "opening the cover tool changed the recipe");
  const checklist = editor.getByRole("list", { name: "上架准备", exact: true });
  await checklist.getByText("待添加", { exact: true }).waitFor();
  await checklist.getByText("已填写", { exact: true }).waitFor();
  await checklist.getByText("本次未检查", { exact: true }).waitFor();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await checklist.scrollIntoViewIfNeeded();
    assert.equal(await editor.evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
    await page.screenshot({ path: dir + "/editor-" + width + ".png", fullPage: true });
  }
  // A nested discard dialog must own Tab/Escape while the editor stays open.
  await editor.getByLabel(/^名称/).fill(target.title + " 未保存");
  await editor.getByRole("button", { name: "取消", exact: true }).click();
  const discard = page.getByRole("alertdialog", { name: "放弃未保存的修改？" });
  const discardCancel = discard.getByRole("button", { name: "取消", exact: true });
  await discardCancel.focus();
  await page.keyboard.press("Tab");
  assert.equal(await discard.getByRole("button", { name: "放弃修改", exact: true }).evaluate(el => document.activeElement === el), true, "parent focus trap prevented keyboard confirmation");
  await page.keyboard.press("Shift+Tab");
  assert.equal(await discardCancel.evaluate(el => document.activeElement === el), true);
  await page.keyboard.press("Escape");
  await discard.waitFor({ state: "hidden" });
  assert.equal(await editor.getByRole("button", { name: "取消", exact: true }).evaluate(el => document.activeElement === el), true, "cancel did not return focus to the editor");
  assert.equal(await editor.getByLabel(/^名称/).inputValue(), target.title + " 未保存", "cancel discarded edits");
  await editor.getByLabel(/^名称/).fill(target.title);
  failCheck = true;
  await editor.getByRole("button", { name: "检查生成配置", exact: true }).click();
  await editor.getByRole("alert").filter({ hasText: "模拟：原模型暂不可用" }).waitFor();
  await editor.getByRole("button", { name: "默认生成模型", exact: true }).click();
  await page.getByRole("option", { name: "视频参考模型", exact: true }).click();
  assert.equal(await editor.getByRole("alert").filter({ hasText: "模拟：原模型暂不可用" }).count(), 0, "stale validation error survived a model change");
  failCheck = false;
  await editor.getByRole("button", { name: "检查生成配置", exact: true }).click();
  await checklist.getByText("已通过", { exact: true }).waitFor();
  await editor.getByLabel(/^名称/).fill(target.title + " 未保存");
  await checklist.getByText("本次未检查", { exact: true }).waitFor();
  await editor.getByRole("button", { name: "取消", exact: true }).click();
  await discardCancel.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await editor.waitFor({ state: "hidden" });
  assert.equal(await page.getByRole("button", { name: "为" + target.title + "制作封面", exact: true }).evaluate(el => document.activeElement === el), true, "closing nested dialogs lost the original trigger focus");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "新建灵感", exact: true }).click();
  const newEditor = page.getByRole("dialog", { name: "新建创作模板", exact: true });
  await newEditor.getByLabel(/^名称/).fill("新的未分类草稿");
  await newEditor.getByRole("button", { name: "保存草稿并制作封面", exact: true }).click();
  await editor.getByRole("region", { name: "AI 生成模板封面", exact: true }).waitFor();
  await editor.getByRole("button", { name: "收起 AI 生成封面", exact: true }).click();
  await editor.getByRole("button", { name: "取消", exact: true }).click();
  await editor.waitFor({ state: "hidden" });
  await page.getByRole("heading", { name: "新的未分类草稿", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "模板分类", exact: true }).innerText(), "全部分类", "saved cover draft is hidden by the previous category");
  assert.equal(generationRequests, 0);
  await category("美食团购");
  await waitForCards(12);
  const search = page.getByRole("textbox", { name: "搜索模板", exact: true });
  await search.fill("  F01  ");
  await page.getByRole("button", { name: "查询", exact: true }).click();
  await waitForCards(1);
  assert.equal(queries.at(-1).keyword, "F01");
  await page.getByRole("button", { name: "删除" + target.title, exact: true }).click();
  await page.getByRole("alertdialog", { name: "删除创作模板" }).getByRole("button", { name: "删除", exact: true }).click();
  await page.getByRole("heading", { name: "没有找到匹配的模板", exact: true }).waitFor();
  await page.getByRole("button", { name: "清除筛选", exact: true }).click();
  await waitForCards(18);
  failList = true;
  await search.fill("失败");
  await page.getByRole("button", { name: "查询", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "模拟分类列表读取失败" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "模板分类", exact: true }).isDisabled(), true);
  assert.equal(await pager.getByRole("button", { name: "下一页", exact: true }).isDisabled(), true);
  failList = false;
  await page.getByRole("button", { name: "查询", exact: true }).click();
  await page.getByRole("heading", { name: "没有找到匹配的模板", exact: true }).waitFor();
  await page.getByRole("button", { name: "重置筛选", exact: true }).click();
  await waitForCards(18);
  await category("万科物业专项");
  await waitForCards(4);
  await page.getByRole("button", { name: "上架状态", exact: true }).click();
  await page.getByRole("option", { name: "已上架", exact: true }).click();
  await page.getByRole("heading", { name: "没有找到匹配的模板", exact: true }).waitFor();
  assert.ok((await page.getByRole("button", { name: "模板分类", exact: true }).innerText()).includes("万科物业专项"), "empty category lost its filter label");
  // The user can change filters while a confirmed deletion is still in flight.
  // Its eventual response must not restore a page captured from the old list.
  limitRows = 55;
  await page.getByRole("button", { name: "重置筛选", exact: true }).click();
  await pager.getByText("1 / 4", { exact: true }).waitFor();
  for (const number of [2, 3, 4]) {
    await pager.getByRole("button", { name: "下一页", exact: true }).click();
    await pager.getByText(number + " / 4", { exact: true }).waitFor();
  }
  await waitForCards(1);
  holdDelete = new Promise(resolve => { releaseDelete = resolve; });
  const deleting = page.waitForRequest(request => request.method() === "DELETE");
  await cards.getByRole("button", { name: /^删除/ }).click();
  await page.getByRole("alertdialog", { name: "删除创作模板" }).getByRole("button", { name: "删除", exact: true }).click();
  await deleting;
  await category("美食团购");
  await waitForCards(11);
  const beforeDeleteResponse = queries.length;
  const refreshed = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === "/api/admin/studio-templates" && url.searchParams.get("category") === "美食团购";
  });
  releaseDelete();
  await refreshed;
  await pager.getByText("1 / 1", { exact: true }).waitFor();
  assert.ok(queries.slice(beforeDeleteResponse).every(query => query.category !== "美食团购" || query.pageNum === "1"), "late deletion jumped to a page from the old filter");
  await waitForCards(11);
  holdDelete = null;
  limitRows = 55;
  await page.getByRole("button", { name: "重置筛选", exact: true }).click();
  await pager.getByText("1 / 4", { exact: true }).waitFor();
  for (const number of [2, 3, 4]) {
    await pager.getByRole("button", { name: "下一页", exact: true }).click();
    await pager.getByText(number + " / 4", { exact: true }).waitFor();
  }
  await waitForCards(1);
  await cards.getByRole("button", { name: /^删除/ }).click();
  await page.getByRole("alertdialog", { name: "删除创作模板" }).getByRole("button", { name: "删除", exact: true }).click();
  await pager.getByText("3 / 3", { exact: true }).waitFor();
  await waitForCards(18);
  assert.equal(queries.at(-1).pageNum, "3", "last-page deletion did not recover the previous page");
  assert.equal(generationRequests, 0);
  assert.deepEqual(errors, []);
  console.log("PASS: catalog pagination/filtering, active tabs, query retry, draft visibility, delayed deletion, mobile layout and cover shortcut without charging.");
} catch (error) {
  await page.screenshot({ path: dir + "/failure.png", fullPage: true }).catch(() => {});
  console.log(JSON.stringify({ url: page.url(), errors, body: (await page.locator("body").innerText()).slice(-5000) }));
  throw error;
} finally {
  releaseDelete();
  await browser.close();
}
