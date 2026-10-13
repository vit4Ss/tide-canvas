import assert from "node:assert/strict";
import { chromium } from "playwright-core";

const base = process.env.FRONTEND_TEST_URL || "http://localhost:3100";
const browser = await chromium.launch({ headless: true, ...(process.platform === "win32" ? { executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" } : { channel: "chrome" }) });
let release;
try {
  const context = await browser.newContext();
  await context.addInitScript(() => localStorage.setItem("access_token","dialog-fixture"));
  let started; const requested = new Promise((resolve) => { started = resolve; });
  const pending = new Promise((resolve) => { release = resolve; });
  await context.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname; let data = {};
    if (path === "/api/auth/me") data = { id:"701",username:"alex",nickname:"Alex",points:10,vipLevel:0 };
    else if (path === "/api/billing/en/plans") data = [{ id:"801",market:"en",currency:"USD",name:"Creator",monthly:12,yearly:120,monthlyPoints:600,items:[],vipLevel:1 }];
    else if (path === "/api/billing/en/channels") data = [{ key:"stripe",name:"Stripe",currency:"USD" }];
    else if (path === "/api/billing/en/faq") data = { items:[] };
    else if (path === "/api/billing/en/compare") data = { rows:[] };
    else if (path === "/api/en/orders") { started();await pending;await route.fulfill({status:503,json:{success:false,code:503,message:"Checkout is temporarily unavailable."}});return; }
    await route.fulfill({json:{success:true,code:200,data}});
  });
  const page = await context.newPage();
  await page.goto(`${base}/pricing`,{waitUntil:"networkidle"});
  await page.getByRole("button",{name:"Choose this plan"}).click();
  await page.getByRole("button",{name:"Continue to checkout"}).click();await requested;
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").isVisible(),true,"Esc hid the busy dialog while React still considered it open");
  release(); await page.getByRole("alert").filter({hasText:"Checkout is temporarily unavailable."}).waitFor();
  await page.keyboard.press("Escape");await page.getByRole("dialog").waitFor({state:"hidden"});
  await page.getByRole("button",{name:"Choose this plan"}).click();
  assert.equal(await page.getByRole("button",{name:"Continue to checkout"}).isEnabled(),true);
  console.log("Payment dialog passed: Esc during submission, visible failure, normal dismissal and reopening.");
} finally { release?.();await browser.close(); }
