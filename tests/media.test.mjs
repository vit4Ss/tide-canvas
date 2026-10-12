import assert from "node:assert/strict";
import test from "node:test";
import { fileMedia, mediaUrl, resultUrls, taskMedia } from "../src/lib/media.ts";

const task = { handler: "text_to_image", resultUrl: "", resultMeta: {} };

test("legacy result metadata supplies files without treating covers or inputs as outputs", () => {
  const meta = { urls: ["/image.png", "/image.png"], assets: [{ url: "/asset.glb", previewImageUrl: "/cover.jpg" }], tracks: [{ url: "/audio.mp3", coverUrl: "/song.jpg" }], input: { url: "/source.jpg" } };
  assert.deepEqual(resultUrls(JSON.stringify(meta), "/primary.png"), ["/primary.png", "/image.png", "/asset.glb", "/audio.mp3"]);
});

test("text generations have readable output instead of an empty image card", () => {
  for (const handler of ["assistant_chat", "skill_text_completion"]) {
    const media = taskMedia({ ...task, handler, resultMeta: JSON.stringify({ text: "An actual generated answer." }) });
    assert.equal(media.kind, "text");
    assert.equal(media.text, "An actual generated answer.");
    assert.deepEqual(media.urls, []);
  }
  assert.equal(taskMedia({ ...task, handler: "assistant_chat", resultMeta: { text: "  preserve indentation\n" } }).text, "  preserve indentation\n");
});

test("captured video frames remain images while enhanced videos remain videos", () => {
  assert.equal(taskMedia({ ...task, handler: "video_frame_capture", resultUrl: "/frame.jpg" }).kind, "image");
  assert.equal(taskMedia({ ...task, handler: "video_upscale", resultUrl: "/upscaled.mp4" }).kind, "video");
});

test("3D assets expose their real cover and prefer GLB when the primary URL is missing", () => {
  const media = taskMedia({ ...task, handler: "generate_3d", resultMeta: { assets: [{ type: "spz", url: "/scene.spz", preview_image_url: "/cover.jpg" }, { type: "glb", url: "/scene.glb" }] } });
  assert.equal(media.kind, "3d");
  assert.equal(media.poster, "/cover.jpg");
  assert.equal(media.urls[0], "/scene.glb");
});

test("audio covers and all generated tracks remain available", () => {
  const media = taskMedia({ ...task, handler: "text_to_audio", resultMeta: { tracks: [{ url: "/one.mp3", coverUrl: "/cover.jpg" }, { url: "/two.mp3" }] } });
  assert.equal(media.kind, "audio");
  assert.equal(media.poster, "/cover.jpg");
  assert.deepEqual(media.urls, ["/one.mp3", "/two.mp3"]);
});

test("malformed or missing metadata does not create invented preview URLs", () => {
  for (const resultMeta of [null, "not-json", "[]", [], { urls: [null, {}, 3] }]) {
    assert.deepEqual(taskMedia({ ...task, resultMeta }).urls, []);
  }
});

test("media URLs preserve signed queries but reject executable, credential and malformed URLs", () => {
  for (const value of ["javascript:alert(1)", "data:image/svg+xml,unsafe", "//external.example/file", "/\\external.example/file", "https://user:secret@example.com/file", "https://example.com/\nfile", "https:ambiguous", "blob:private"]) assert.equal(mediaUrl(value), "");
  const signed = "https://media.example/file.mp4?signature=a%2Fb&expires=123";
  assert.equal(mediaUrl(signed), signed);
  assert.equal(mediaUrl("/static/uploads/file.jpg"), "/static/uploads/file.jpg");
});

test("uploaded media uses its file type or MIME without trying to display audio as an image", () => {
  const file = { fileUrl: "/original", fileType: "other", mimeType: "audio/mpeg", originalName: "track.mp3" };
  assert.equal(fileMedia(file).kind, "audio");
  assert.equal(fileMedia({ ...file, mimeType: "video/mp4" }).kind, "video");
  assert.equal(fileMedia({ ...file, mimeType: "model/gltf-binary", originalName: "scene.glb" }).kind, "3d");
  assert.equal(fileMedia({ ...file, mimeType: "application/pdf", originalName: "brief.pdf" }).kind, "file");
});
