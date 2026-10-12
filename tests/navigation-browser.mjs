import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";

const base = process.env.FRONTEND_TEST_URL || "http://localhost:3100";
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : { channel: "chrome" }) });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: "reduce" });
const page = await context.newPage();
page.setDefaultTimeout(10000);
const errors = [];
const writes = [];
const models = [
  { id: "gpt", name: "GPT Image 2", modelKey: "gpt-image-2", type: "image", pointCost: "4", config: { resolutions: ["1k", "4k"] } },
  { id: "suno", name: "Suno V5", modelKey: "suno-v5", type: "audio", pointCost: "10", config: {} },
  ...Array.from({ length: 120 }, (_, i) => ({ id: `extra-${i}`, name: `Community model ${i}`, modelKey: `extra-${i}`, type: "image", pointCost: "4", config: {} })),
];
await mkdir(".impeccable/review", { recursive: true });
page.on("pageerror", (error) => errors.push(error.message));
await context.addInitScript(() => localStorage.setItem("access_token", "navigation-test-only"));
await context.route("**/api/**", (route) => {
  const request = route.request();
  const url = new URL(request.url());
  if (request.method() !== "GET") writes.push(url.pathname);
  let data = {};
  if (url.pathname === "/api/auth/me") data = { id: "42", username: "alex", nickname: "Alex", role: 0, points: 1200 };
  else if (url.pathname === "/api/market/studio-models") data = models.filter((model) => !url.searchParams.get("type") || url.searchParams.get("type") === model.type);
  else if (url.pathname === "/api/ai/optimize-cost") data = { cost: 5 };
  else if (url.pathname === "/api/ai/tasks") data = { records: [{ id: "creation", handler: "text_to_image", modelName: "GPT Image 2", status: 1, pointCost: 4, resultUrl: `${base}/art/coast.jpg`, createTime: "2026-10-12T09:00:00Z", input: { prompt: "Coast" } }], total: 1 };
  else if (["/api/files", "/api/ai/history"].includes(url.pathname)) data = { records: [], total: 0 };
  return route.fulfill({ json: { success: true, code: 200, data } });
});
const goto = (path) => page.goto(base + path, { waitUntil: "networkidle" });
const focusIs = (selector) => page.waitForFunction((selector) => document.activeElement?.matches(selector), selector);

try {
  await goto("/studio");
  await page.keyboard.press("Tab"); // Skip link.
  await page.keyboard.press("Tab");
  await focusIs('.workspace-topbar button');
  assert.equal(await page.getByRole("navigation", { name: "Workspace navigation" }).count(), 0, "Closed mobile drawer leaves the accessibility tree");
  const open = page.getByRole("button", { name: "Open workspace navigation", exact: true });
  const close = page.getByRole("button", { name: "Close workspace navigation", exact: true });
  await open.click();
  await focusIs('[data-close-navigation]');
  assert.equal(await page.locator(".workspace-body").evaluate((element) => element.inert), true);
  await page.getByRole("button", { name: "Sign out", exact: true }).focus();
  await page.keyboard.press("Tab");
  await focusIs('.sidebar-brand .brand');
  await page.keyboard.press("Shift+Tab");
  await focusIs('.sidebar-bottom button');
  await page.keyboard.press("Escape");
  await focusIs('.workspace-topbar button');
  assert.equal(await open.getAttribute("aria-expanded"), "false");
  assert.equal(await page.evaluate(() => document.body.style.overflow), "");
  await open.click();
  await page.locator(".sidebar-scrim").click({ position: { x: 360, y: 600 } });
  await page.waitForFunction(() => !document.querySelector(".workspace-body").inert);
  await open.click();
  await page.getByRole("navigation", { name: "Workspace navigation" }).getByRole("link", { name: "Library", exact: true }).click();
  await page.waitForURL("**/library");
  assert.equal(await page.evaluate(() => document.body.style.overflow), "", "Navigating out must release the scroll lock");

  await goto("/studio");
  await page.setViewportSize({ width: 740, height: 375 });
  await open.click();
  const signOut = page.getByRole("button", { name: "Sign out", exact: true });
  await signOut.scrollIntoViewIfNeeded();
  assert.ok((await signOut.boundingBox()).y >= 0 && (await signOut.boundingBox()).y < 375, "Drawer bottom is reachable in landscape");
  await page.screenshot({ path: ".impeccable/review/navigation-landscape.png" });
  await page.setViewportSize({ width: 1440, height: 500 });
  await page.waitForFunction(() => !document.querySelector(".workspace-body").inert);
  assert.equal(await page.locator(".workspace-sidebar").getAttribute("role"), null);
  assert.equal(await page.evaluate(() => document.body.style.overflow), "");
  await signOut.scrollIntoViewIfNeeded();
  assert.ok((await signOut.boundingBox()).y < 500, "Short desktop sidebar can scroll");
  await page.setViewportSize({ width: 390, height: 844 });
  await close.waitFor({ state: "hidden" });
  await page.getByRole("textbox", { name: "Your prompt", exact: true }).fill("A coast");
  for (const name of ["Enhance prompt", "Try an idea"]) {
    const button = page.getByRole("button", { name, exact: true });
    assert.ok((await button.boundingBox()).height >= 44, `${name} touch target`);
  }
  assert.equal(await page.locator("#studio-prompt").evaluate((element) => getComputedStyle(element).fontSize), "16px");
  assert.equal(await page.locator(".task-caption small").evaluate((element) => getComputedStyle(element).fontSize), "11px");
  assert.equal(await page.locator(".task-caption").evaluate((element) => element.scrollWidth <= element.clientWidth), true, "Card metadata stays inside its column");
  await page.getByRole("button", { name: "Preview creation", exact: true }).first().click();
  await page.getByRole("dialog", { name: "GPT Image 2", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "GPT Image 2", exact: true }).waitFor({ state: "hidden" });
  await focusIs(".task-card .task-image");
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({ path: ".impeccable/review/studio-touch-audit.png", fullPage: true });

  await goto("/models");
  const navToggle = page.getByRole("button", { name: "Open navigation", exact: true });
  await navToggle.click();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Models", exact: true }).focus();
  await page.keyboard.press("Escape");
  assert.equal(await navToggle.evaluate((element) => element === document.activeElement), true);
  await navToggle.click();
  await page.mouse.click(370, 700);
  assert.equal(await navToggle.getAttribute("aria-expanded"), "false");
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.getByRole("button", { name: "Image", exact: true }).click();
  const search = page.getByRole("textbox", { name: "Search models", exact: true });
  await search.pressSequentially("GPT Image 2", { delay: 10 });
  assert.equal(await search.inputValue(), "GPT Image 2", "Quick typing must not lose characters");
  assert.equal(new URL(page.url()).searchParams.get("q"), "GPT Image 2");
  await page.locator('article[data-model-key="gpt-image-2"] a').click();
  await page.waitForURL("**/studio?type=image&model=gpt-image-2");
  await page.goBack({ waitUntil: "networkidle" });
  await search.waitFor();
  assert.equal(await search.inputValue(), "GPT Image 2", "Back restores the search");
  assert.equal(await page.getByRole("button", { name: "Image", exact: true }).getAttribute("aria-pressed"), "true");
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await search.inputValue(), "GPT Image 2", "Reload preserves the filter URL");
  await search.fill("A&B + 3/4?");
  assert.equal(new URL(page.url()).searchParams.get("q"), "A&B + 3/4?");
  await page.getByRole("button", { name: "Reset filters", exact: true }).click();
  assert.equal(await search.inputValue(), "");
  assert.equal(await page.locator("article[data-model-key]").count(), models.length);
  assert.equal(new URL(page.url()).search, "");
  await page.reload({ waitUntil: "networkidle" });
  await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  await focusIs("main");
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => !!document.activeElement.closest("main")), true, "Skip link bypasses header navigation");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.setViewportSize({ width: 390, height: 844 });
  await goto("/studio");
  await open.click();
  await focusIs('[data-close-navigation]');
  await page.keyboard.press("Escape");
  await focusIs('.workspace-topbar button');
  assert.deepEqual(writes, [], "Navigation and preview must never submit paid work");
  assert.deepEqual(errors, []);
  console.log("PASS: mobile/landscape/short-desktop navigation; focus, dismissal and scroll cleanup; touch targets; named preview; rapid catalog search and Back/reload restoration.");
} finally {
  await browser.close();
}
