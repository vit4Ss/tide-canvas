import assert from "node:assert/strict";
import test from "node:test";
import { MAX_PROJECT_THUMBNAIL_CHARS, persistableProjectThumbnail } from "./canvas-thumbnail.ts";

test("project cover accepts only persistent HTTP URLs that fit the database column", () => {
  const prefix = "https://cdn.example/";
  assert.equal(persistableProjectThumbnail(prefix + "a".repeat(MAX_PROJECT_THUMBNAIL_CHARS - prefix.length)), true);
  assert.equal(persistableProjectThumbnail(prefix + "a".repeat(MAX_PROJECT_THUMBNAIL_CHARS - prefix.length + 1)), false);
  assert.equal(persistableProjectThumbnail("blob:temporary"), false);
  assert.equal(persistableProjectThumbnail("data:image/png;base64,abc"), false);
});

test("character counting matches the backend rune limit", () => {
  const prefix = "https://cdn.example/";
  assert.equal(persistableProjectThumbnail(prefix + "图".repeat(MAX_PROJECT_THUMBNAIL_CHARS - prefix.length)), true);
  assert.equal(persistableProjectThumbnail(prefix + "🙂".repeat(MAX_PROJECT_THUMBNAIL_CHARS - prefix.length + 1)), false);
});
