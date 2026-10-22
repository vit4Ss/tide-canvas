import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

let source = stripTypeScriptTypes(readFileSync(new URL("./canvas-video-references.ts", import.meta.url), "utf8"));
for (const module of ["canvas-node-types", "canvas-connection-rules"]) {
  source = source.replace(`"./${module}"`, JSON.stringify(new URL(`./${module}.ts`, import.meta.url).href));
}
const { canvasVideoReferences, canvasVideoReferenceKind } = await import(`data:text/javascript,${encodeURIComponent(source)}`);
const target = { id: "target", type: "video" };
const image = (id, extra = {}) => ({ id, type: "image", imageSrc: `https://cdn.example/${id}.png`, ...extra });
const edge = (sourceId, targetId) => ({ id: `${sourceId}-${targetId}`, sourceId, targetId });
const ids = (nodes, connections = [], options) => canvasVideoReferences(nodes, connections, "target", options).map(({ node }) => node.id);

test("video candidates match supported media and text consumption, including concept settings", () => {
  const nodes = [target, image("image"), image("director", { type: "scene_3d" }),
    { id: "video", type: "video", videoSrc: "https://cdn.example/video.mp4" },
    { id: "audio", type: "audio", audioSrc: "https://cdn.example/audio.mp3" },
    { id: "text", type: "text", content: "A scene" },
    { id: "character", type: "character", prompt: "A friendly explorer" },
    { id: "scene", type: "scene", prompt: "A quiet station" },
    { id: "script", type: "script", prompt: "Not consumed by video" },
    { id: "empty-text", type: "text", content: "  ", prompt: "Not output text" },
    image("style", { type: "style_reference" }), image("empty", { imageSrc: "" })];
  assert.deepEqual(ids(nodes), ["image", "director", "video", "audio", "text", "character", "scene"]);
  assert.equal(canvasVideoReferenceKind(nodes[2]), "image");
  assert.equal(canvasVideoReferenceKind(nodes[6]), "text");
  assert.equal(canvasVideoReferences(nodes, [], "target").find(({ node }) => node.id === "character").settingOnly, true);
});

test("unready and temporary media cannot enter the picker even when a preview exists", () => {
  const nodes = [target, image("ready"), image("upload", { uploading: true }), image("pending", { pendingGeneration: {} }),
    image("generating", { status: "generating" }), image("blob", { imageSrc: "blob:local" }),
    image("character-blob", { type: "character", imageSrc: "blob:local", prompt: "A draft role" })];
  assert.deepEqual(ids(nodes), ["ready"]);
});

test("direct and transitive descendants are excluded and existing references are not offered twice", () => {
  const nodes = [target, ...["child", "grandchild", "connected", "available"].map((id) => image(id))];
  const connections = [edge("target", "child"), edge("child", "grandchild"), edge("grandchild", "child"), edge("connected", "target")];
  assert.deepEqual(ids(nodes, connections), ["available"]);
  assert.deepEqual(ids(nodes, [...connections, edge("available", "target")]), []);
});

test("kind filters and the character library preserve written role context without adding a fake image", () => {
  const nodes = [target, image("photo"), image("character", { type: "character" }),
    { id: "setting", type: "character", prompt: "Traveling musician" },
    { id: "scene", type: "scene", prompt: "Studio" }, { id: "text", type: "text", content: "Story" }];
  assert.deepEqual(ids(nodes, [], { allowedKinds: ["image"] }), ["photo", "character"]);
  assert.deepEqual(ids(nodes, [], { allowedKinds: ["text"] }), ["setting", "scene", "text"]);
  assert.deepEqual(ids(nodes, [], { characterOnly: true, allowedKinds: ["image"] }), ["character", "setting"]);
  assert.equal(canvasVideoReferences(nodes, [], "target", { characterOnly: true }).find(({ node }) => node.id === "setting").kind, "text");
});

test("candidate lookup respects target connection contracts and a deleted target", () => {
  const nodes = [{ ...target, type: "audio" }, image("photo")];
  assert.deepEqual(ids(nodes), []);
  assert.deepEqual(canvasVideoReferences(nodes, [], "missing"), []);
});
