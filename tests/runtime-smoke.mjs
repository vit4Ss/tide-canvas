import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { cp, access } from "node:fs/promises";
import path from "node:path";
import { once } from "node:events";

const execute = promisify(execFile);
const image = process.env.RUNTIME_TEST_IMAGE;
const root = process.cwd();
const standalone = path.join(root, ".next", "standalone");
const applications = []; const backends = []; const streams = new Map();
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const listen = async (server) => { server.listen(0, "127.0.0.1"); await once(server, "listening"); return server.address().port; };
async function unusedPort() { const server = createServer(); const port = await listen(server); await new Promise((resolve) => server.close(resolve)); return port; }

async function backend(environment) {
  const server = createServer(async (request, response) => {
    if (request.url === "/api/events") {
      response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      response.write(`data: ${environment}-first\n\n`);
      streams.set(environment, () => response.end(`data: ${environment}-last\n\n`));
      return;
    }
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    response.setHeader("Content-Type", "application/json");
    response.setHeader("Set-Cookie", ["nonce_a=fixture-a; Path=/api/auth/google; HttpOnly; SameSite=Strict", "nonce_b=fixture-b; Path=/api/auth/google; HttpOnly; SameSite=Strict"]);
    response.end(JSON.stringify({ environment, url: request.url, method: request.method, authorization: request.headers.authorization, origin: request.headers.origin, cookie: request.headers.cookie, contentType: request.headers["content-type"], bytes: body.length, ...(request.url.startsWith("/api/echo") ? { body: body.toString() } : {}) }));
  });
  backends.push(server);
  return `http://127.0.0.1:${await listen(server)}`;
}

async function start(environment) {
  const port = await unusedPort(); const backendUrl = await backend(environment);
  const config = {
    NODE_ENV: "production", APP_ENV: environment, PORT: String(port), HOSTNAME: "127.0.0.1",
    BACKEND_URL: backendUrl, SITE_URL: `https://${environment}.framelyn.example`, BRAND_NAME: `Framelyn ${environment}`,
    GOOGLE_CLIENT_ID: `${environment}-fixture.apps.googleusercontent.com`, BILLING_CURRENCY: environment === "prod" ? "CNY" : "USD",
    SUPPORT_EMAIL: `${environment}@framelyn.example`, PRIVATE_RUNTIME_SENTINEL: "do-not-expose-runtime-secret",
  };
  const name = `framelyn-runtime-${environment}-${process.pid}`;
  const child = image
    ? spawn("docker", ["run", "--rm", "--network", "host", "--name", name, ...Object.entries(config).flatMap(([key, value]) => ["--env", `${key}=${value}`]), image], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })
    : spawn(process.execPath, ["server.js"], { cwd: standalone, env: { ...process.env, ...config }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const application = { child, config, name, url: `http://127.0.0.1:${port}`, logs: "", backendUrl, error: null };
  applications.push(application);
  child.on("error", (error) => { application.error = error; });
  child.stdout.on("data", (chunk) => { application.logs = (application.logs + chunk).slice(-4000); });
  child.stderr.on("data", (chunk) => { application.logs = (application.logs + chunk).slice(-4000); });
  for (let retry = 0; retry < 120; retry += 1) {
    if (application.error) throw application.error;
    if (child.exitCode !== null) throw new Error(`App exited: ${application.logs}`);
    try { if ((await fetch(`${application.url}/healthz`, { signal: AbortSignal.timeout(1000) })).ok) return application; } catch { /* Wait for the owned server to bind. */ }
    await pause(250);
  }
  throw new Error(`App did not start: ${application.logs}`);
}

try {
  if (!image) {
    await access(path.join(standalone, "server.js"));
    // Assemble exactly the public/static layout copied by the Dockerfile.
    await cp(path.join(root, "public"), path.join(standalone, "public"), { recursive: true, force: true });
    await cp(path.join(root, ".next/static"), path.join(standalone, ".next/static"), { recursive: true, force: true });
  }
  const prod = await start("prod"); const staging = await start("test");
  for (const app of [prod, staging]) {
    const { config, url } = app;
    console.log(`Checking ${config.APP_ENV} runtime config and SSR`);
    assert.equal((await (await fetch(`${url}/healthz`)).json()).environment, config.APP_ENV);
    const publicResponse = await fetch(`${url}/runtime-config`);
    const publicConfig = await publicResponse.json();
    assert.equal(publicResponse.headers.get("cache-control"), "no-store");
    assert.equal(publicConfig.siteUrl, config.SITE_URL); assert.equal(publicConfig.googleClientId, config.GOOGLE_CLIENT_ID);
    assert.equal(publicConfig.currency, config.BILLING_CURRENCY); assert.equal(publicConfig.name, config.BRAND_NAME);
    assert.equal(JSON.stringify(publicConfig).includes("do-not-expose-runtime-secret"), false);
    assert.equal(JSON.stringify(publicConfig).includes(app.backendUrl), false);
    const page = await fetch(`${url}/login`); const html = await page.text();
    assert.ok(html.includes(config.BRAND_NAME)); assert.ok(html.includes(config.GOOGLE_CLIENT_ID));
    assert.equal(html.includes("do-not-expose-runtime-secret"), false); assert.equal(html.includes(app.backendUrl), false);
    assert.equal(page.headers.get("x-robots-tag"), config.APP_ENV === "test" ? "noindex, nofollow" : null);
    assert.equal((await fetch(`${url}/art/coast.jpg`)).status, 200);
    const script = html.match(/src="([^\"]*\/_next\/static\/[^\"]+\.js)"/);
    assert.ok(script); assert.equal((await fetch(new URL(script[1].replaceAll("&amp;", "&"), url))).status, 200);
    const robots = await (await fetch(`${url}/robots.txt`)).text(); const sitemap = await (await fetch(`${url}/sitemap.xml`)).text();
    if (config.APP_ENV === "prod") { assert.ok(robots.includes(`${config.SITE_URL}/sitemap.xml`)); assert.ok(sitemap.includes(config.SITE_URL)); }
    else { assert.ok(robots.includes("Disallow: /")); assert.equal(sitemap.includes("<loc>"), false); }
    const echo = await fetch(`${url}/api/echo?value=a%20b`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer runtime-fixture", Origin: config.SITE_URL, Cookie: "browser_nonce=fixture" }, body: '{"nonce":"fixture","value":42}' });
    const data = await echo.json();
    assert.equal(data.environment, config.APP_ENV); assert.equal(data.url, "/api/echo?value=a%20b"); assert.equal(data.method, "POST");
    assert.equal(data.authorization, "Bearer runtime-fixture"); assert.equal(data.origin, config.SITE_URL); assert.equal(data.cookie, "browser_nonce=fixture");
    assert.equal(data.body, '{"nonce":"fixture","value":42}'); assert.equal(echo.headers.getSetCookie().length, 2);
    const form = new FormData(); form.set("file", new Blob(["x".repeat(1024*1024)]), "fixture.txt");
    const upload = await (await fetch(`${url}/api/upload`, { method: "POST", body: form })).json();
    assert.equal(upload.environment, config.APP_ENV); assert.ok(upload.bytes > 1024*1024); assert.ok(upload.contentType.startsWith("multipart/form-data;"));
    console.log(`Checking ${config.APP_ENV} event-stream delivery`);
    const response = await fetch(`${url}/api/events`, { signal: AbortSignal.timeout(5000) }); const reader = response.body.getReader();
    const first = new TextDecoder().decode((await reader.read()).value); assert.ok(first.includes(`${config.APP_ENV}-first`));
    streams.get(config.APP_ENV)(); let last = "";
    for (;;) { const chunk = await reader.read(); if (chunk.done) break; last += new TextDecoder().decode(chunk.value); }
    assert.ok(last.includes(`${config.APP_ENV}-last`));
  }
  console.log(`Same ${image ? "Docker image" : "standalone build"} passed prod/test runtime isolation, public-config whitelist, SSR branding/Google ID, SEO, assets, API routing, authentication/cookies, multipart upload and streaming.`);
} finally {
  for (const release of streams.values()) release();
  for (const app of applications) {
    if (image) await execute("docker", ["rm", "-f", app.name], { windowsHide: true }).catch(() => {});
    const exited = app.child.exitCode === null && app.child.signalCode === null ? once(app.child, "exit").catch(() => {}) : Promise.resolve();
    app.child.kill(); await Promise.race([exited, pause(3000)]);
  }
  for (const server of backends) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
}
