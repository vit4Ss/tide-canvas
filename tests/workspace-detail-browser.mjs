import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";

const base = process.env.FRONTEND_TEST_URL || "http://localhost:3100";
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : { channel: "chrome" }) });
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, reducedMotion: "reduce" });
const page = await context.newPage();
page.setDefaultTimeout(12000);
const errors = [], generations = [];
let optimizeCalls = 0, releaseOptimization, releaseDetail;
let accountId = "42";
let holdDetail = true, failDetail = false, failDelete = true;
const models = [{ id: "image", name: "GPT Image 2", modelKey: "gpt-image-2", type: "image", pointCost: "4", config: { modes: ["t2i", "i2i"] } }, { id: "video", name: "Veo 3", modelKey: "veo-3", type: "video", pointCost: "10", config: {} }];
const records = [{ id: "a", model: "GPT Image 2", mediaType: "image", prompt: "A quiet coast at sunrise", pointCost: 4, success: 1, createTime: "2026-10-12T08:00:00Z", durationMs: 1200, isApiCall: false }, { id: "b", model: "GPT Image 2", mediaType: "image", prompt: "A sculptural garden", pointCost: 12, refundedPoints: 12, success: 0, createTime: "2026-10-12T07:00:00Z", durationMs: 2000, isApiCall: true }];
let files = Array.from({ length: 25 }, (_, i) => ({ id: `file-${i}`, originalName: `A long reference filename ${i}.jpg`, fileUrl: "/art/coast.jpg", fileType: "image", mimeType: "image/jpeg", fileSize: 130000, createTime: "2026-10-12T08:00:00Z" }));
await mkdir(".impeccable/review", { recursive: true });
await context.addInitScript(() => localStorage.setItem("access_token", "workspace-test-only"));
page.on("pageerror", (error) => errors.push(error.message));
await context.route("**/api/**", async (route) => {
  const req = route.request(), url = new URL(req.url()), path = url.pathname;
  let data = {};
  if (path === "/api/auth/me") data = { id: accountId, username: "alex", nickname: accountId === "42" ? "Alex" : "Other account", role: 0, points: 1200 };
  else if (path === "/api/market/studio-models") data = models.filter((model) => !url.searchParams.get("type") || model.type === url.searchParams.get("type"));
  else if (path === "/api/ai/optimize-cost") data = { cost: 5 };
  else if (path === "/api/ai/optimize-prompt") {
    optimizeCalls++;
    data = await new Promise((resolve) => { releaseOptimization = (prompt) => resolve({ prompt }); });
  } else if (path === "/api/ai/generate") { generations.push(req.postDataJSON()); data = {}; }
  else if (path === "/api/ai/tasks") data = { records: [], total: 0, pages: 0 };
  else if (path === "/api/ai/history") {
    const filtered = accountId === "42" ? records.filter((row) => (!url.searchParams.get("mediaType") || row.mediaType === url.searchParams.get("mediaType")) && (!url.searchParams.get("success") || String(row.success) === url.searchParams.get("success")) && (!url.searchParams.get("keyword") || row.prompt.includes(url.searchParams.get("keyword")))) : [];
    data = { records: filtered, total: filtered.length, pages: 1 };
  } else if (path.startsWith("/api/ai/history/")) {
    const id = path.split("/").at(-1);
    if (holdDetail && id === "a") await new Promise((resolve) => { releaseDetail = resolve; });
    if (failDetail) return route.fulfill({ json: { success: false, code: 503, message: "Details are temporarily unavailable." } });
    data = { ...records.find((row) => row.id === id), resultAssets: [], parameters: [] };
  } else if (path === "/api/files") {
    const visible = url.searchParams.get("mediaKind") === "video" ? [] : files;
    const start = (Number(url.searchParams.get("pageNum") || 1) - 1) * 24;
    data = { records: visible.slice(start, start + 24), total: visible.length, pages: Math.ceil(visible.length / 24) };
  } else if (path === "/api/files/presign") data = { existingFile: files[0] };
  else if (path.startsWith("/api/files/detail/") && req.method() === "DELETE") {
    if (failDelete) return route.fulfill({ json: { success: false, code: 503, message: "Could not delete this file. Try again." } });
    files = files.filter((file) => file.id !== path.split("/").at(-1));
  }
  await route.fulfill({ json: { success: true, code: 200, data } }).catch(() => {}); // Closed detail requests are intentionally aborted.
});
const goto = (path) => page.goto(base + path, { waitUntil: "networkidle" });
const details = () => page.getByRole("dialog", { name: "Creation details", exact: true });

try {
  await goto("/studio");
  const prompt = page.getByRole("textbox", { name: "Your prompt", exact: true });
  await prompt.fill("Original draft");
  const optimizing = page.waitForRequest("**/api/ai/optimize-prompt");
  await page.getByRole("button", { name: "Enhance prompt", exact: true }).click(); await optimizing;
  await prompt.fill("My newer draft");
  releaseOptimization("Enhanced original draft");
  const suggestion = page.getByRole("textbox", { name: "Enhanced prompt suggestion", exact: true });
  await suggestion.waitFor();
  assert.equal(await prompt.inputValue(), "My newer draft", "A delayed enhancement cannot replace newer edits");
  assert.equal(await suggestion.inputValue(), "Enhanced original draft");
  await page.getByRole("button", { name: "Keep my draft", exact: true }).click();
  assert.equal(await prompt.inputValue(), "My newer draft");
  const second = page.waitForRequest("**/api/ai/optimize-prompt");
  await page.getByRole("button", { name: "Enhance prompt", exact: true }).click(); await second;
  releaseOptimization("Enhanced newer draft");
  await page.waitForFunction(() => document.querySelector("#studio-prompt").value === "Enhanced newer draft");
  assert.equal(optimizeCalls, 2, "Each click sends exactly one enhancement request");
  const third = page.waitForRequest("**/api/ai/optimize-prompt");
  await page.getByRole("button", { name: "Enhance prompt", exact: true }).click(); await third;
  await prompt.fill("Another edit");
  releaseOptimization("A saved alternative");
  await suggestion.waitFor();
  await page.getByRole("button", { name: "Use suggestion", exact: true }).click();
  assert.equal(await prompt.inputValue(), "A saved alternative");
  assert.equal(optimizeCalls, 3, "Applying a saved suggestion does not call the service again");
  await page.locator('input[type="file"]').setInputFiles({ name: "reference.png", mimeType: "image/png", buffer: Buffer.from("mock image upload") });
  await page.getByRole("button", { name: "Remove reference.png", exact: true }).waitFor();
  await page.getByRole("tab", { name: "Image", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Remove reference.png", exact: true }).count(), 1, "Clicking the current format keeps references");
  await page.getByRole("tab", { name: "Image", exact: true }).press("ArrowRight");
  assert.equal(await page.getByRole("tab", { name: "Video", exact: true }).evaluate((element) => element === document.activeElement), true);
  assert.equal(await page.getByRole("tab", { name: "Image", exact: true }).getAttribute("aria-selected"), "true", "Exploring tabs does not reset the draft");
  await page.keyboard.press("Enter");
  assert.equal(await page.getByRole("tab", { name: "Video", exact: true }).getAttribute("aria-selected"), "true");
  await page.getByRole("tab", { name: "Video", exact: true }).press("Home");
  assert.equal(await page.getByRole("tab", { name: "Image", exact: true }).evaluate((element) => element === document.activeElement), true);

  await goto("/history");
  const firstDetail = page.waitForRequest("**/api/ai/history/a");
  await page.getByRole("button", { name: "View activity details", exact: true }).first().click(); await firstDetail;
  await details().getByRole("status").waitFor();
  await details().getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.getByRole("button", { name: "View activity details", exact: true }).nth(1).click();
  await details().getByText("A sculptural garden", { exact: true }).waitFor();
  releaseDetail();
  assert.equal(await details().getByText("A quiet coast at sunrise", { exact: true }).count(), 0, "An older detail response cannot replace the chosen record");
  await details().getByRole("button", { name: "Close dialog", exact: true }).click();
  holdDetail = false; failDetail = true;
  await page.getByRole("button", { name: "View activity details", exact: true }).first().click();
  await details().getByRole("alert").waitFor();
  failDetail = false;
  await details().getByRole("button", { name: "Try again", exact: true }).click();
  await details().getByText("A quiet coast at sunrise", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("textbox", { name: "Search activity", exact: true }).fill("missing");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByText("No matching creations.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Reset filters", exact: true }).click();
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.getByRole("button", { name: "View activity details", exact: true }).first().waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Activity overflow at ${width}`);
    if (width === 390 || width === 1440) await page.screenshot({ path: `.impeccable/review/activity-detail-${width}.png`, fullPage: true });
    if (width < 650) assert.ok((await page.getByRole("button", { name: "View activity details", exact: true }).first().boundingBox()).height >= 44);
  }

  await goto("/library");
  await page.getByRole("button", { name: "Uploaded files", exact: true }).click();
  await page.getByRole("button", { name: "Video", exact: true }).click();
  await page.getByText("No assets in this format.", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Clear filter", exact: true }).click();
  await page.locator(".library-card").first().waitFor();
  assert.equal(await page.locator(".library-card footer span").first().evaluate((element) => getComputedStyle(element).fontSize), "11px");
  assert.ok((await page.locator(".library-card footer .icon-button").first().boundingBox()).height >= 44);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Delete A long reference filename 24.jpg", exact: true }).click();
  const deletion = page.getByRole("dialog", { name: "Delete this file?", exact: true });
  await deletion.getByRole("button", { name: "Delete file", exact: true }).click();
  await deletion.getByRole("alert").waitFor();
  failDelete = false;
  await deletion.getByRole("button", { name: "Delete file", exact: true }).click();
  await deletion.waitFor({ state: "hidden" });
  await page.getByRole("heading", { name: "A long reference filename 0.jpg", exact: true }).waitFor();
  assert.equal(await page.locator(".library-card").count(), 24, "Deleting the last item returns to a populated page");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await page.screenshot({ path: ".impeccable/review/library-detail-mobile.png" });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  files = [];
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Uploaded files", exact: true }).click();
  await page.getByRole("button", { name: "Upload your first file", exact: true }).waitFor();
  await goto("/history");
  holdDetail = true;
  const pendingPrivate = page.waitForRequest("**/api/ai/history/a");
  await page.getByRole("button", { name: "View activity details", exact: true }).first().click(); await pendingPrivate;
  accountId = "other";
  await page.evaluate(() => { localStorage.setItem("access_token", "different-test-account"); window.dispatchEvent(new StorageEvent("storage", { key: "access_token" })); });
  await page.waitForFunction(() => document.querySelector(".workspace-switcher")?.textContent.includes("Other account"));
  releaseDetail();
  assert.equal(await page.getByRole("dialog").count(), 0, "Account switching closes private details and their pending requests");
  assert.equal(await page.getByText("A quiet coast at sunrise", { exact: true }).count(), 0);
  assert.deepEqual(generations, [], "Inspecting, filtering and previewing do not submit generation tasks");
  assert.deepEqual(errors, []);
  console.log("PASS: delayed prompt enhancement; single-request enhancement; non-destructive keyboard tabs; immediate/cancellable/retryable activity details; responsive records; library empty filters, deletion errors and last-page recovery.");
} finally { await browser.close(); }
