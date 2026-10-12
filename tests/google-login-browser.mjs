import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright-core";
import path from "node:path";
import { englishError } from "../src/lib/english.ts";

const base = process.env.FRONTEND_TEST_URL || "http://localhost:3100";
const clientId = (await (await fetch(`${base}/runtime-config`)).json()).googleClientId;
assert.ok(clientId, "Set the frontend Google Client ID to run the browser integration test");
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" });
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
const page = await context.newPage(); const errors = []; const requests = [];
page.on("pageerror", (error) => errors.push(error.message));
let scenario = "success"; let linked = false;
let heldGoogle; let heldOldMe; let releaseGoogle; let releaseOldMe;
const user = { id: "90071992547409930", username: "creator", nickname: "Creator", email: "creator@example.com", role: 0, points: 42 };
const login = { accessToken: "qa-google-access", refreshToken: "qa-google-refresh", userInfo: user, expiresIn: 3600 };
await context.route("https://accounts.google.com/gsi/client*", (route) => route.fulfill({ contentType: "application/javascript", body: `window.google={accounts:{id:{initialize(options){window.qaGoogle=options},renderButton(element,options){const button=document.createElement('button');button.type='button';button.className='button';button.textContent='Continue with Google';button.style.width=options.width+'px';button.onclick=()=>window.qaGoogle.callback({credential:'qa-google-credential'});element.append(button)},cancel(){}}}};` }));
await context.route("**/api/**", async (route) => {
  const request = route.request(); const pathname = new URL(request.url()).pathname;
  let body; try { body = request.postDataJSON(); } catch { body = null; }
  requests.push({ pathname, body }); let data = null; let code = 200; let message = "success";
  if (pathname === "/api/auth/google/challenge") {
    if (scenario === "unavailable") { code = 503; message = "Google sign-in is temporarily unavailable. Use your password or try again later."; }
    else data = { clientId: scenario === "mismatch" ? "different.apps.googleusercontent.com" : clientId, nonce: "a".repeat(43), expiresIn: 300 };
  } else if (pathname === "/api/auth/google") {
    if (scenario === "held-google") { heldGoogle = true; await new Promise((resolve) => { releaseGoogle = resolve; }); }
    if (["link", "verify-email"].includes(scenario) && !body.code) { code = 409; message = "Verify your email to continue."; data = { requiresLink: true, email: user.email, existingAccount: scenario === "link" }; }
    else if (["link", "verify-email"].includes(scenario) && body.code !== "123456") { code = 400; message = "The verification code is incorrect or expired."; }
    else if (scenario === "disabled") { code = 403; message = "This account is disabled. Contact support."; }
    else { linked = scenario === "link"; data = scenario === "malformed" ? null : login; }
  } else if (pathname === "/api/auth/login") data = login;
  else if (pathname === "/api/auth/me") {
    if (scenario === "stale-account" && request.headers().authorization === "Bearer old-access") { heldOldMe = true; await new Promise((resolve) => { releaseOldMe = resolve; }); data = { ...user, id: "old-account", nickname: "Previous account" }; }
    else data = request.headers().authorization === "Bearer privacy-owner-access" ? { ...user, id: "privacy-owner", nickname: "Privacy account" } : user;
  }
  else if (pathname === "/api/auth/register-config") data = { registerClosed: false };
  else if (pathname === "/api/market/studio-models") data = [];
  else if (pathname === "/api/points/balance") data = { points: 42, frozen: 0 };
  else if (pathname === "/api/ai/tasks") data = { records: [], total: 0, pageNum: 1, pageSize: 24 };
  else if (pathname === "/api/ai/history") data = { records: request.headers().authorization === "Bearer privacy-owner-access" ? [] : [{ id: "private-record", model: "Image model", prompt: "Private previous-account prompt", mediaType: "image", success: 1, pointCost: 4, createTime: "2026-10-12T08:00:00Z" }], total: 1, pageNum: 1, pageSize: 20 };
  else if (pathname === "/api/ai/history/private-record") data = { id: "private-record", model: "Image model", prompt: "Private previous-account prompt", pointCost: 4, durationMs: 1000, resultAssets: [], parameters: [], createTime: "2026-10-12T08:00:00Z" };
  await route.fulfill({ status: code, contentType: "application/json", body: JSON.stringify({ success: code === 200, code, message, data, timestamp: Date.now() }) }).catch((error) => { if (!request.failure()) throw error; });
});
const goto = async () => { await page.goto(`${base}/login?redirect=/account`); await page.waitForLoadState("domcontentloaded"); };
const clear = async () => { await page.evaluate(() => localStorage.clear()); };
const artifacts = path.join(process.cwd(), ".impeccable/review"); await mkdir(artifacts, { recursive: true });
try {
  await goto(); await page.getByRole("button", { name: "Continue with Google", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.qaGoogle.nonce), "a".repeat(43));
  await page.screenshot({ path: path.join(artifacts, "google-login-desktop.png"), fullPage: true });
  await page.getByRole("button", { name: "Continue with Google", exact: true }).click(); await page.waitForURL("**/account");
  assert.equal(await page.evaluate(() => localStorage.getItem("access_token")), login.accessToken);
  assert.equal(requests.find((entry) => entry.pathname === "/api/auth/google").body.credential, "qa-google-credential");
  assert.equal(requests.find((entry) => entry.pathname === "/api/auth/google").body.nonce, "a".repeat(43));
  await page.goto(`${base}/history`); await page.getByRole("button", { name: "View activity details", exact: true }).click(); await page.getByRole("dialog").waitFor();
  await page.evaluate(() => { localStorage.setItem("access_token", "privacy-owner-access"); localStorage.setItem("refresh_token", "privacy-owner-refresh"); window.dispatchEvent(new StorageEvent("storage", { key: "access_token" })); });
  await page.waitForFunction(() => document.querySelector('.workspace-switcher')?.textContent.includes("Privacy account"));
  assert.equal(await page.getByRole("dialog").count(), 0, "Previous-account detail survived an account switch");
  assert.equal((await page.locator("body").innerText()).includes("Private previous-account prompt"), false);
  await clear(); scenario = "link"; await goto(); await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
  await page.getByText("Link your existing account", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem("access_token")), null);
  await page.getByRole("button", { name: "Send code", exact: true }).click();
  assert.equal(requests.find((entry) => entry.pathname === "/api/auth/email-code").body.email, user.email);
  await page.getByLabel("Email verification code", { exact: true }).fill("000000");
  await page.getByRole("button", { name: "Verify and continue", exact: true }).click();
  await page.getByText(englishError("The verification code is incorrect or expired."), { exact: true }).waitFor();
  await page.getByLabel("Email verification code", { exact: true }).fill("123456");
  await page.getByRole("button", { name: "Verify and continue", exact: true }).click(); await page.waitForURL("**/account"); assert.equal(linked, true);
  await clear(); scenario = "verify-email"; await goto(); await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
  await page.getByText("Verify your email", { exact: true }).waitFor();
  await page.getByLabel("Email verification code", { exact: true }).fill("123456");
  await page.getByRole("button", { name: "Verify and continue", exact: true }).click(); await page.waitForURL("**/account");
  for (const [name, message] of [["disabled", "This account is disabled. Contact support."], ["unavailable", "Google sign-in is temporarily unavailable. Use your password or try again later."], ["mismatch", "Google sign-in is not configured for this website. Please use your password."]]) {
    await clear(); scenario = name; await goto();
    if (name === "disabled") await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
    await page.getByText(message, { exact: true }).waitFor(); assert.equal(await page.evaluate(() => localStorage.getItem("access_token")), null);
  }
  // Google outage must leave the existing password flow usable.
  await page.getByLabel("Email or username", { exact: true }).fill("creator"); await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click(); await page.waitForURL("**/account");
  // A slow previous-account lookup must not replace a newly authenticated user.
  await page.evaluate(() => { localStorage.setItem("access_token", "old-access"); localStorage.setItem("refresh_token", "old-refresh"); });
  scenario = "stale-account"; await goto();
  await page.getByRole("button", { name: "Continue with Google", exact: true }).waitFor(); assert.equal(heldOldMe, true);
  await page.getByRole("button", { name: "Continue with Google", exact: true }).click(); await page.waitForURL("**/account");
  const oldResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/auth/me" && response.request().headers().authorization === "Bearer old-access");
  releaseOldMe(); await (await oldResponse).finished();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal((await page.locator(".workspace-switcher").innerText()).includes("Previous account"), false, "Stale account lookup overwrote new login");
  assert.ok((await page.locator(".workspace-switcher").innerText()).includes("Creator"));
  await clear(); scenario = "malformed"; await goto(); await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
  await page.getByText("The Google sign-in response was incomplete. Please try again.", { exact: true }).waitFor(); assert.equal(await page.evaluate(() => localStorage.getItem("access_token")), null);
  // A stalled exchange must time out and restore the password fallback.
  await clear(); scenario = "held-google"; await page.clock.install(); await goto();
  await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.auth-google')?.textContent.includes("Signing in…")); assert.equal(heldGoogle, true);
  await page.clock.fastForward(21_000);
  await page.getByText("Google sign-in was interrupted or timed out. Please start again.", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Sign in", exact: true }).isEnabled(), true);
  assert.equal(await page.evaluate(() => localStorage.getItem("access_token")), null); releaseGoogle(); await page.clock.resume();
  // A Google response arriving after another account change must not replace it.
  scenario = "held-google"; heldGoogle = false; await goto(); await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.auth-google')?.textContent.includes("Signing in…"));
  await page.evaluate(() => { localStorage.setItem("access_token", "replacement-access"); localStorage.setItem("refresh_token", "replacement-refresh"); window.dispatchEvent(new StorageEvent("storage", { key: "access_token" })); });
  releaseGoogle(); await page.getByText("Your session changed while signing in. Please try again.", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem("access_token")), "replacement-access");
  // Even an anonymous -> signed-in -> anonymous cycle invalidates the old result.
  await clear(); scenario = "held-google"; await goto(); await page.getByRole("button", { name: "Continue with Google", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.auth-google')?.textContent.includes("Signing in…"));
  await page.evaluate(() => {
    localStorage.setItem("access_token", "another-access"); window.dispatchEvent(new StorageEvent("storage", { key: "access_token" }));
    localStorage.removeItem("access_token"); localStorage.removeItem("refresh_token"); window.dispatchEvent(new StorageEvent("storage", { key: "access_token" }));
  });
  releaseGoogle(); await page.getByText("Your session changed while signing in. Please try again.", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => localStorage.getItem("access_token")), null, "Delayed Google login undid a later logout");
  await clear(); scenario = "success"; await page.setViewportSize({ width: 390, height: 844 }); await goto();
  await page.getByRole("button", { name: "Continue with Google", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "Mobile login overflow");
  await page.screenshot({ path: path.join(artifacts, "google-login-mobile.png"), fullPage: true });
  await page.goto(`${base}/signup`); await page.getByRole("button", { name: "Continue with Google", exact: true }).waitFor();
  const username = page.getByLabel("Username", { exact: true });
  await username.fill("ab-c"); assert.equal(await username.evaluate((input) => input.checkValidity()), false, "Username contract allows a backend-rejected hyphen");
  await username.fill("ab"); assert.equal(await username.evaluate((input) => input.checkValidity()), false, "Username contract allows fewer than four characters");
  await username.fill("creator_2026"); assert.equal(await username.evaluate((input) => input.checkValidity()), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, "Mobile signup overflow");
  await page.goto(`${base}/forgot-password`); assert.equal(await page.locator(".auth-google").count(), 0);
  assert.deepEqual(errors, []);
  console.log("Google browser integration passed: nonce forwarding, session, safe email linking, invalid code, disabled account, unavailable service, client mismatch, password fallback, stale profile, stalled exchange, account-change/ABA guards, malformed response, username contract and responsive login/signup. All provider and API requests used fixtures.");
} finally { await browser.close(); }
