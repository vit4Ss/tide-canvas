import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const base = process.env.ADMIN_TEST_URL || "http://localhost:3101";
const browser = await chromium.launch({ headless: true, ...(process.platform === "win32" ? { executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" } : { channel: "chrome" }) });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  await context.addInitScript(() => { localStorage.setItem("access_token", "admin-pricing-fixture"); localStorage.setItem("refresh_token", "admin-pricing-refresh"); });
  const cnPlan = { id: "1001", market: "cn", currency: "CNY", name: "中文套餐", code: "pro", monthly: 60, yearly: 600, monthlyPoints: 600, status: 1, sortOrder: 0, vipLevel: 1, featured: false, hideCta: false, desc: "中文站价格", cta: "立即购买", items: ["每月 600 积分"] };
  const enPlans = [];
  const writes = [];
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    let data = {};
    if (request.method() !== "GET") writes.push({ pathname, body: request.postDataJSON() });
    if (pathname === "/api/auth/me") data = { id: "90071992547409930", role: 9, username: "admin", nickname: "Pricing operator", adminPerms: ["admin.pricing"], points: 0 };
    else if (pathname === "/api/admin/plans") data = [cnPlan];
    else if (pathname === "/api/admin/en/plans") {
      if (request.method() === "POST") { const plan = { ...request.postDataJSON(), id: "2002", market: "en", currency: "USD" }; enPlans.push(plan); data = plan; }
      else data = enPlans;
    } else if (pathname.endsWith("/pricing/compare")) data = { rows: [] };
    else if (pathname.endsWith("/pricing/faq")) data = { items: [] };
    else if (pathname.endsWith("/pricing/promo")) data = { enabled: false, title: "", tag: "", subtitle: "", endsAt: "", deals: [] };
    await route.fulfill({ json: { success: true, code: 200, message: "", data, timestamp: Date.now() } });
  });
  const page = await context.newPage();
  await page.goto(`${base}/admin/pricing`, { waitUntil: "networkidle", timeout: 90000 });
  await page.getByLabel("会员套餐列表").getByText("中文套餐", { exact: true }).waitFor();
  await page.getByRole("button", { name: "英文站 · USD", exact: true }).click();
  await page.getByText("还没有会员套餐", { exact: true }).waitFor();
  assert.equal(await page.getByText("中文套餐", { exact: true }).count(), 0);
  await page.getByRole("button", { name: "新增套餐", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByPlaceholder("如：创作者 Pro").fill("Creator");
  await dialog.getByPlaceholder("如：en_pro").fill("en_creator");
  await dialog.getByPlaceholder("如：39", { exact: true }).fill("19.99");
  await dialog.getByPlaceholder("如：468（月价 39 × 12 = 468，可再打折）").fill("199.99");
  await dialog.getByPlaceholder("如：3000", { exact: true }).fill("600");
  await dialog.getByRole("button", { name: "保存套餐", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.getByLabel("会员套餐列表").getByText("Creator", { exact: true }).waitFor();
  assert.equal(enPlans[0].status, 0, "New English plans must start unpublished");
  assert.equal(enPlans[0].monthly, 19.99);
  assert.equal(enPlans[0].yearly, 199.99);
  assert.equal(writes[0].pathname, "/api/admin/en/plans");
  await page.screenshot({ path: ".impeccable/review/admin-pricing-en-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: ".impeccable/review/admin-pricing-en-mobile.png" });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.getByRole("button", { name: "中文站 · CNY", exact: true }).click();
  await page.getByLabel("会员套餐列表").getByText("中文套餐", { exact: true }).waitFor();
  assert.equal(await page.getByText("Creator", { exact: true }).count(), 0);
  assert.equal(cnPlan.monthly, 60);
  assert.equal(writes.some((write) => write.pathname === "/api/admin/plans"), false);
  console.log("Admin pricing passed: CN/EN switch, USD create payload, unpublished default, independent prices, desktop/mobile. All writes used fixtures.");
} finally { await browser.close(); }
