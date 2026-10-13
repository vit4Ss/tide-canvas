import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const base = process.env.ADMIN_TEST_URL || "http://localhost:3101";
const browser = await chromium.launch({ headless: true, ...(process.platform === "win32" ? { executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" } : { channel: "chrome" }) });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  await context.addInitScript(() => localStorage.setItem("access_token", "stripe-admin-fixture"));
  await context.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data = {};
    if (path === "/api/auth/me") data = { id: "701", role: 9, username: "admin", nickname: "Finance operator", points: 0 };
    else if (path === "/api/admin/pay/channels") data = [{ id: "1", name: "Stripe", type: "stripe", currency: "USD", enabled: true, rate: 0, todayAmount: 0 }, { id: "2", name: "Alipay", type: "alipay", currency: "CNY", enabled: true, rate: 0, todayAmount: 60 }];
    else if (path === "/api/admin/orders") data = { records: [
      { id: "1", orderNo: "USD-STRIPE-ORDER", currency: "USD", market: "en", amount: 120, payMethod: "stripe", status: 1, user: { id: "701", username: "alex" }, type: "plan", createTime: "2026-10-13T00:00:00Z" },
      { id: "2", orderNo: "CNY-LEGACY-ORDER", currency: "CNY", market: "cn", amount: 60, payMethod: "alipay", status: 1, user: { id: "702", username: "lee" }, type: "plan", createTime: "2026-10-13T00:00:00Z" },
    ], total: 2, pageNum: 1, pageSize: 20 };
    await route.fulfill({ json: { success: true, code: 200, data } });
  });
  const page = await context.newPage(); const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/admin/payments`, { waitUntil: "networkidle", timeout: 90000 });
  await page.getByText("USD-STRIPE-ORDER", { exact: true }).waitFor();
  const usd = page.getByRole("row").filter({ hasText: "USD-STRIPE-ORDER" });
  const cny = page.getByRole("row").filter({ hasText: "CNY-LEGACY-ORDER" });
  assert.match(await usd.innerText(), /US\$120\.00/); assert.doesNotMatch(await usd.innerText(), /¥120/);
  assert.match(await cny.innerText(), /¥60\.00/);
  await page.getByText("本页已付 USD", { exact: true }).waitFor();
  await page.getByText("本页已付 CNY", { exact: true }).waitFor();
  await page.screenshot({ path: ".impeccable/review/stripe-admin-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: ".impeccable/review/stripe-admin-mobile.png", fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log("Admin Stripe/CNY order formatting and separate totals passed at desktop/mobile widths.");
} finally { await browser.close(); }
