import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CANVAS_AUDIO_ACCEPT, CANVAS_DROP_ACCEPT, canvasDropFileInfo, canvasStoredFileInfo } from "./canvas-drop-files.ts";

test("canvas drop recognizes supported MIME families", () => {
  assert.deepEqual(canvasDropFileInfo({ name: "photo.bin", type: "image/webp" }), { kind: "image", mimeType: "image/webp" });
  assert.deepEqual(canvasDropFileInfo({ name: "clip.bin", type: "video/mp4" }), { kind: "video", mimeType: "video/mp4" });
  assert.deepEqual(canvasDropFileInfo({ name: "voice.bin", type: "audio/mpeg" }), { kind: "audio", mimeType: "audio/mpeg" });
  assert.deepEqual(canvasDropFileInfo({ name: "room.bin", type: "model/gltf-binary" }), { kind: "3d", mimeType: "model/gltf-binary" });
});

test("canvas drop falls back to extensions when Windows supplies no useful MIME", () => {
  assert.deepEqual(canvasDropFileInfo({ name: "SHOT.MP4", type: "" }), { kind: "video", mimeType: "video/mp4" });
  assert.deepEqual(canvasDropFileInfo({ name: "mix.flac", type: "application/octet-stream" }), { kind: "audio", mimeType: "audio/flac" });
  assert.deepEqual(canvasDropFileInfo({ name: "scene.GLB" }), { kind: "3d", mimeType: "model/gltf-binary" });
  assert.deepEqual(canvasDropFileInfo({ name: "cover.jpeg" }), { kind: "image", mimeType: "image/jpeg" });
  assert.deepEqual(canvasDropFileInfo({ name: "windows-export.jfif", type: "" }), { kind: "image", mimeType: "image/jpeg" });
});

test("canvas drop rejects active content, dependent 3D formats and unrelated files", () => {
  for (const file of [
    { name: "vector.svg", type: "image/svg+xml" },
    { name: "scene.gltf", type: "model/gltf+json" },
    { name: "mesh.obj", type: "application/octet-stream" },
    { name: "notes.pdf", type: "application/pdf" },
    { name: "folder", type: "" },
    { name: "disguised.png", type: "image/svg+xml" },
    { name: "disguised.jpg", type: "text/html" },
  ]) assert.equal(canvasDropFileInfo(file), null, file.name);
  assert.equal(CANVAS_DROP_ACCEPT, "image/*,video/*,audio/*,.glb");
  assert.equal(CANVAS_AUDIO_ACCEPT, "audio/*,.mp3,.wav,.m4a,.aac,.ogg,.oga,.flac,.opus");
});

test("stored-file hints never override explicit unsupported format evidence", () => {
  assert.deepEqual(canvasStoredFileInfo({ name: "", type: "", fileType: "image" }), { kind: "image", mimeType: "image/png" });
  assert.deepEqual(canvasStoredFileInfo({ name: "", type: "application/octet-stream", fileType: "video" }), { kind: "video", mimeType: "video/mp4" });
  assert.equal(canvasStoredFileInfo({ name: "legacy.svg", type: "image/svg+xml", fileType: "image" }), null);
  assert.equal(canvasStoredFileInfo({ name: "document.pdf", type: "application/pdf", fileType: "image" }), null);
});

test("canvas root materializes every supported drop as its real node type", () => {
  const source = readFileSync(new URL("../components/canvas/canvas-view.tsx", import.meta.url), "utf8");
  assert.match(source, /const kind = entry\.info\.kind;[\s\S]*createNode\(kind,/);
  assert.match(source, /kind === "audio"[\s\S]*audioSrc: res\.data\.fileUrl/);
  assert.match(source, /kind === "3d"[\s\S]*modelAssets: \[\{ type: "glb", url: res\.data\.fileUrl \}\]/);
  assert.match(source, /MAX_CANVAS_UPLOAD_FILES = 24/);
  assert.match(source, /CANVAS_UPLOAD_CONCURRENCY = 3[\s\S]*entries\.slice\(start, start \+ CANVAS_UPLOAD_CONCURRENCY\)/);
  assert.match(source, /accept=\{CANVAS_DROP_ACCEPT\}/);
  assert.doesNotMatch(source, /仅支持拖入图片或视频/);
});

test("canvas asset picker uses the same audio and GLB classification contract", () => {
  const source = readFileSync(new URL("../components/canvas/my-assets-panel.tsx", import.meta.url), "utf8");
  assert.match(source, /canvasStoredFileInfo\(\{ name: f\.originalName, type: f\.mimeType, fileType: f\.fileType \}\)/);
  assert.match(source, /key: "audio", label: "音频", query: \{ mediaKind: "audio"/);
  assert.match(source, /kind === "3d" \? <Box/);
  assert.match(source, /disabled=\{!kind\}/);
});
