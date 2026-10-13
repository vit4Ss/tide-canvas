import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const base = process.env.FRONTEND_TEST_URL || "http://localhost:3100";
const browser = await chromium.launch({ headless: true, ...(process.platform === "win32" ? { executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" } : { channel: "chrome" }) });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  await context.addInitScript(() => { localStorage.setItem("access_token", "pricing-fixture"); localStorage.setItem("refresh_token", "pricing-fixture-refresh"); });
  const page = await context.newPage();
  const requests = [];
  let oldCatalog = false;
  const plan = { id: "en-plan", market: "en", currency: "USD", name: "Creator", desc: "Credits for your next project.", monthly: 12.5, yearly: 120, monthlyPoints: 600, items: ["Image, video, audio and 3D creation"], vipLevel: 1 };
  await context.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    requests.push({ pathname, method: route.request().method() });
    let data = {};
    if (pathname === "/api/auth/me") data = { id: "90071992547409930", role: 0, username: "alex", nickname: "Alex", points: 60 };
    else if (pathname === "/api/billing/en/plans") data = oldCatalog ? [{ ...plan, market: "cn", currency: "CNY", name: "Wrong catalog" }] : [plan];
    // A misconfigured/old response must not let CNY methods pay for USD plans.
    else if (pathname === "/api/billing/en/channels") data = [{ key: "alipay", name: "Alipay", currency: "CNY" }];
    else if (pathname === "/api/billing/en/faq") data = { items: [{ q: "A question from the English admin", a: "An independently maintained answer." }] };
    else if (pathname === "/api/billing/en/compare") data = { rows: [{ label: "Credits per purchase", values: { "en-plan": "600" } }] };
    else if (pathname === "/api/billing/en/promo") data = { enabled: false };
    else if (pathname === "/api/orders/legacy") data = { id: "legacy", orderNo: "LEGACY-CNY", type: "plan", amount: 60, currency: "CNY", status: 1, createTime: "2026-10-12T08:00:00Z" };
    await route.fulfill({ json: { success: true, code: 200, data } });
  });
  await page.goto(`${base}/pricing`, { waitUntil: "networkidle" });
  assert.equal((await page.locator(".plan-price").innerText()).includes("$12.50"), true);
  assert.equal(await page.getByRole("button", { name: "Checkout unavailable" }).isDisabled(), true);
  await page.getByRole("button", { name: "12× credits", exact: true }).click();
  assert.match(await page.locator(".plan-price").innerText(), /\$120/);
  assert.match(await page.locator(".plan-billed").innerText(), /\$120 paid once/);
  assert.match(await page.locator(".plan-credit").innerText(), /7,200/);
  await page.getByRole("heading", { name: "Compare plans" }).waitFor();
  await page.getByText("A question from the English admin", { exact: true }).click();
  await page.getByText("An independently maintained answer.", { exact: true }).waitFor();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({ path: ".impeccable/review/pricing-usd-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({ path: ".impeccable/review/pricing-usd-mobile.png", fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.equal(requests.some((request) => request.method === "POST"), false, "Unavailable checkout must not create an order");
  assert.equal(requests.some((request) => request.pathname === "/api/billing/plans"), false, "Never fall back to the CNY catalog");
  oldCatalog = true;
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await page.locator(".pricing-card").count(), 0, "A CNY response must not be relabeled as USD");
  await page.goto(`${base}/billing?order=legacy`, { waitUntil: "networkidle" });
  assert.match(await page.locator(".invoice-total").innerText(), /CN¥60/);
  console.log("USD pricing passed: independent catalog, annual totals, credit allowance, admin content, currency gate, no CNY fallback, legacy invoice currency, desktop/mobile.");
} finally { await browser.close(); }
