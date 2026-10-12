import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { mkdir, readFile, access } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { taskMedia } from "../src/lib/media.ts";

const base = process.env.FRONTEND_TEST_URL || "http://localhost:3100";
const fixture = path.resolve(".runtime/media-tests/preview.mp4");
await mkdir(path.dirname(fixture), { recursive: true });
await mkdir(".impeccable/review", { recursive: true });
try { await access(fixture); } catch {
  const result = spawnSync(process.env.FFMPEG_PATH || "ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-loop", "1", "-i", "public/art/coast.jpg", "-t", "1", "-vf", "scale=320:-2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", fixture], { encoding: "utf8" });
  assert.equal(result.status, 0, `Video fixture requires ffmpeg: ${result.error?.message || result.stderr}`);
}
const videoBytes = await readFile(fixture);
const imageBytes = await readFile("public/art/coast.jpg");
let fixtureOrder = 0;
const makeTask = (id, handler, resultUrl, resultMeta = {}) => ({ id, handler, resultUrl, resultMeta, modelName: id, status: 1, progress: 100, pointCost: 4, createTime: new Date(Date.parse("2026-10-12T08:00:00Z") - fixtureOrder++ * 1000).toISOString() });
const text = "A quiet coast at sunrise.\n\nA real text result belongs in a readable preview, with the full response available when opened.";
const tasks = [
  makeTask("Video first frame", "text_to_video", "/qa-media/first.mp4"),
  makeTask("Video with cover", "video_upscale", "/qa-media/covered.mp4", { posterUrl: "/art/coast.jpg" }),
  makeTask("Expired cover fallback", "image_to_video", "/qa-media/fallback.mp4", { posterUrl: "/qa-media/missing-cover.jpg" }),
  makeTask("Image from metadata", "text_to_image", "", JSON.stringify({ urls: ["/art/architecture.jpg"] })),
  makeTask("Captured frame", "video_frame_capture", "/art/portrait.jpg"),
  makeTask("Text output", "assistant_chat", "", { text }),
  makeTask("3D with cover", "generate_3d", "", { assets: [{ type: "glb", url: "/qa-media/model.glb", previewImageUrl: "/art/architecture.jpg" }] }),
  makeTask("Audio with cover", "text_to_audio", "", { tracks: [{ url: "/qa-media/track.mp3", coverUrl: "/art/coast.jpg" }] }),
  makeTask("Missing output", "text_to_image", ""),
  makeTask("Broken image", "text_to_image", "/qa-media/broken.jpg"),
  makeTask("Broken video", "text_to_video", "/qa-media/broken.mp4"),
  ...Array.from({ length: 12 }, (_, index) => makeTask(`Image ${index + 1}`, "text_to_image", "/art/coast.jpg")),
  makeTask("Deferred video", "text_to_video", "/qa-media/offscreen.mp4"),
];
const files = [{ id: "upload-1", fileUrl: "/qa-media/upload.mp4", fileType: "video", mimeType: "video/mp4", originalName: "Uploaded video", fileSize: videoBytes.length, createTime: "2026-10-12T08:00:00Z" }];
const browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : process.platform === "win32" ? { executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" } : { channel: "chrome" }) });
const results = [];
try {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1050 }, isMobile: mobile, hasTouch: mobile });
    await context.addInitScript(() => { localStorage.setItem("access_token", "qa-media-token"); localStorage.setItem("refresh_token", "qa-media-refresh"); });
    let repairImage = false;
    const videoRequests = [];
    await context.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      const records = tasks.filter((task) => !url.searchParams.get("mediaType") || taskMedia(task).kind === url.searchParams.get("mediaType"));
      const data = url.pathname === "/api/auth/me" ? { id: "90071992547409930", username: "alex", nickname: "Alex", points: 1200, role: 0 }
        : url.pathname === "/api/ai/tasks" ? { records, total: records.length, pages: 1 }
        : url.pathname === "/api/files" ? { records: files, total: 1, pages: 1 } : {};
      await route.fulfill({ json: { success: true, code: 200, data } });
    });
    await context.route("**/qa-media/**", async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname.endsWith(".mp4")) videoRequests.push(pathname);
      if (pathname === "/qa-media/broken.jpg" && repairImage) return route.fulfill({ contentType: "image/jpeg", body: imageBytes, headers: { "Cache-Control": "no-store" } });
      if (pathname.includes("broken") || pathname.includes("missing")) return route.fulfill({ status: 404, body: "Not found", headers: { "Cache-Control": "no-store" } });
      if (pathname.endsWith(".mp4")) {
        const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range || "");
        if (range) {
          const start = Number(range[1]);
          const end = Math.min(range[2] ? Number(range[2]) : videoBytes.length - 1, videoBytes.length - 1);
          return route.fulfill({ status: 206, contentType: "video/mp4", body: videoBytes.subarray(start, end + 1), headers: { "Accept-Ranges": "bytes", "Content-Range": `bytes ${start}-${end}/${videoBytes.length}` } });
        }
        return route.fulfill({ contentType: "video/mp4", body: videoBytes, headers: { "Accept-Ranges": "bytes" } });
      }
      return route.fulfill({ status: 404, body: "Not found" });
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const card = (title) => page.locator(".library-card").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
    const ready = async (title) => {
      const target = card(title);
      await target.scrollIntoViewIfNeeded();
      await target.locator('[data-preview-state="ready"]').waitFor();
      return target;
    };
    await page.goto(`${base}/library`, { waitUntil: "networkidle" });
    const first = await ready("Video first frame");
    const state = await first.locator("video").evaluate((video) => ({ decoded: video.videoWidth > 0, paused: video.paused, muted: video.muted, time: video.currentTime, duration: video.duration, cors: video.crossOrigin }));
    assert.ok(state.decoded && state.paused && state.muted && state.time > 0 && state.cors === null, `A real frame loads without autoplay or requiring CORS: ${JSON.stringify(state)}`);
    assert.equal(videoRequests.includes("/qa-media/offscreen.mp4"), false, "Offscreen videos do not load eagerly");
    const covered = await ready("Video with cover");
    assert.equal(await covered.locator("video").count(), 0, "A supplied cover avoids downloading video");
    const fallback = await ready("Expired cover fallback");
    assert.equal(await fallback.locator("video").count(), 1, "A failed poster falls back to a decoded frame");
    await ready("Image from metadata");
    const captured = await ready("Captured frame");
    assert.equal(await captured.locator("img").count(), 1);
    assert.equal(await captured.locator("video").count(), 0);
    await ready("3D with cover");
    await ready("Audio with cover");
    assert.equal(await card("3D with cover").getByRole("link").getAttribute("href"), "/qa-media/model.glb");
    assert.equal(await card("Audio with cover").getByRole("link").getAttribute("href"), "/qa-media/track.mp3");
    assert.equal(await card("Missing output").getByRole("link").count(), 0, "No empty download link is rendered");
    await card("Broken video").scrollIntoViewIfNeeded();
    await card("Broken video").getByText("Preview unavailable").waitFor();
    await card("Broken image").getByText("Preview unavailable").waitFor();
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await page.screenshot({ path: `.impeccable/review/library-media-${mobile ? "mobile" : "desktop"}.png` });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);

    if (!mobile) {
      await card("Broken image").getByRole("button").click();
      await page.getByRole("dialog").getByRole("alert").waitFor();
      repairImage = true;
      await page.getByRole("button", { name: "Try again", exact: true }).click();
      await page.waitForFunction(() => document.querySelector("dialog img")?.naturalWidth > 0);
      await page.getByRole("button", { name: "Close dialog" }).click();
      const deferred = await ready("Deferred video");
      assert.ok(videoRequests.includes("/qa-media/offscreen.mp4"));
      assert.equal(await deferred.locator("video").evaluate((video) => video.paused), true);
      assert.equal(await card("Text output").count(), 0, "Text generations stay hidden in the English library");
      assert.equal(await page.getByRole("button", { name: "Text", exact: true }).count(), 0);
      await page.getByRole("button", { name: "Uploaded files", exact: true }).click();
      const upload = await ready("Uploaded video");
      assert.equal(await upload.locator("video").evaluate((video) => video.videoWidth > 0), true);
    }
    assert.deepEqual(errors, []);
    results.push({ mobile, firstFrame: state, videoRequests: videoRequests.length, runtimeErrors: errors });
    await context.close();
  }
  console.log(JSON.stringify({ status: "passed", results }, null, 2));
} finally {
  await browser.close();
}
