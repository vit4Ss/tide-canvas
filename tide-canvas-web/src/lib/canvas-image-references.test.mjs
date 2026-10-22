import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

const source = stripTypeScriptTypes(readFileSync(new URL("./canvas-image-references.ts", import.meta.url), "utf8"))
  .replace('"./canvas-node-types"', JSON.stringify(new URL("./canvas-node-types.ts", import.meta.url).href));
const { canvasImageReferences, imageReferenceCount } = await import(`data:text/javascript,${encodeURIComponent(source)}`);
const image = (id, extra = {}) => ({ id, type: "image", title: id, imageSrc: `https://cdn.example/${id}.png`, ...extra });
const edge = (sourceId, targetId) => ({ id: `${sourceId}-${targetId}`, sourceId, targetId });

test("reference candidates exclude the current canvas node, style covers and in-flight media", () => {
  const nodes = [image("target"), image("photo"), image("character", { type: "character" }), image("style", { type: "style_reference" }), image("upload", { uploading: true }), image("task", { status: "generating" }), image("pending", { pendingGeneration: {} }), image("blob", { imageSrc: "blob:local" }), image("empty", { imageSrc: undefined })];
  assert.deepEqual(canvasImageReferences(nodes, [], "target").map((node) => node.id), ["photo", "character"]);
});

test("selecting a reference cannot create direct or transitive dependency cycles", () => {
  const nodes = ["target", "child", "grandchild", "upstream", "other"].map((id) => image(id));
  const connections = [edge("target", "child"), edge("child", "grandchild"), edge("upstream", "target")];
  assert.deepEqual(canvasImageReferences(nodes, connections, "target").map((node) => node.id), ["upstream", "other"]);
  assert.doesNotThrow(() => canvasImageReferences(nodes, [...connections, edge("grandchild", "child")], "target"));
});

test("reference limit includes the base image and incoming media once, excluding text and style covers", () => {
  const nodes = [image("target"), image("photo"), image("style", { type: "style_reference" }), { id: "text", type: "text", content: "description" }, { id: "video", type: "video", videoSrc: "https://cdn.example/a.mp4" }, image("unrelated")];
  const connections = [edge("photo", "target"), { ...edge("photo", "target"), id: "duplicate" }, edge("style", "target"), edge("text", "target"), edge("video", "target")];
  assert.equal(imageReferenceCount(nodes, connections, "target"), 3);
  assert.equal(imageReferenceCount(nodes.filter((node) => node.id !== "target"), connections, "target"), 2);
});
