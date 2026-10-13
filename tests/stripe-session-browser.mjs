import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const base = process.env.FRONTEND_TEST_URL || "http://localhost:3100";
const token = (revision) => `header.${Buffer.from(JSON.stringify({ uid: "701", revision })).toString("base64url")}.signature`;
const browser = await chromium.launch({ headless: true, ...(process.platform === "win32" ? { executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" } : { channel: "chrome" }) });
try {
  const results = [];
  for (const action of ["verify", "resume", "create", "cancel"]) {
    const context = await browser.newContext();
    await context.addInitScript((access) => localStorage.setItem("access_token", access), token(1));
    const page = await context.newPage(); const errors = []; page.on("pageerror", (error) => errors.push(error.message));
    const endpoint = action === "create" ? "/api/en/orders" : `/api/orders/9001/${action === "resume" ? "checkout" : action}`;
    let started; const requested = new Promise((resolve) => { started = resolve; });
    let release; const pending = new Promise((resolve) => { release = resolve; });
    const order = { id: "9001", orderNo: "SESSION-REVIEW", market: "en", currency: "USD", payMethod: "stripe", amount: 12, status: 0, createTime: new Date().toISOString(), payUrl: action === "resume" ? "" : "https://checkout.stripe.com/c/pay/cs_test_fixture" };
    let holds = true;
    await context.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      let data = {};
      if (path === "/api/auth/me") data = { id: "701", username: "alex", nickname: "Alex", points: 10, vipLevel: 0 };
      else if (path === "/api/billing/en/plans") data = [{ id: "801", market: "en", currency: "USD", name: "Creator", monthly: 12, yearly: 120, monthlyPoints: 600, vipLevel: 1, items: [] }];
      else if (path === "/api/billing/en/channels") data = [{ key: "stripe", name: "Stripe", currency: "USD" }];
      else if (path === "/api/billing/en/faq") data = { items: [] };
      else if (path === "/api/billing/en/compare") data = { rows: [] };
      else if (path === "/api/orders/9001") data = order;
      else if (path === "/api/orders") data = { records: [order], total: 1, pageNum: 1, pageSize: 15 };
      else if (path === endpoint) {
        if (holds) { started(); await pending; holds = false; }
        data = action === "verify" ? { paid: false, granted: false } : order;
      }
      await route.fulfill({ json: { success: true, code: 200, data } });
    });
    try {
      await page.goto(`${base}${action === "create" ? "/pricing" : action === "cancel" ? "/account?tab=orders" : "/billing?order=9001"}`, { waitUntil: "networkidle" });
      if (action === "create") await page.getByRole("button", { name: "Choose this plan" }).click();
      if (action === "cancel") await page.getByRole("button", { name: "Cancel", exact: true }).click();
      const button = page.getByRole("button", { name: action === "create" ? "Continue to checkout" : action === "resume" ? "Prepare checkout" : action === "cancel" ? "Cancel order" : "Check payment status" });
      await button.click(); await requested;
      await page.evaluate(({ previous, next }) => {
        localStorage.setItem("access_token", next);
        window.dispatchEvent(new StorageEvent("storage", { key: "access_token", oldValue: previous, newValue: next }));
      }, { previous: token(1), next: token(2) });
      const response = page.waitForResponse((r) => new URL(r.url()).pathname === endpoint);
      release(); await response; await page.waitForLoadState("networkidle");
      const available = page.getByRole("button", { name: action === "create" ? "Continue to checkout" : action === "resume" ? "Prepare checkout" : action === "cancel" ? "Cancel order" : "Check payment status" });
      assert.equal(await available.count(), 1, `${action}: busy state never cleared after same-account token refresh`);
      assert.equal(await available.isEnabled(), true, `${action}: payment action remained locked`);
      assert.equal(errors.length, 0, errors.join("\n"));
      results.push({ action, passed: true });
    } catch (error) { results.push({ action, passed: false, error: error.message }); }
    finally { release(); await context.close(); }
  }
  console.log(JSON.stringify(results, null, 2));
  assert.ok(results.every((result) => result.passed), "Same-account session refresh locked a payment action");
} finally { await browser.close(); }
