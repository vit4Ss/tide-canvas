import assert from "node:assert/strict";
import test from "node:test";
import {
  assetLibraryChangesAffectView,
  assetLibraryChangesSince,
  assetLibraryRevision,
  notifyAssetLibraryChanged,
} from "./asset-library-events.ts";

test("asset library invalidation advances monotonically outside the browser", () => {
  const before = assetLibraryRevision();
  notifyAssetLibraryChanged({ collection: "upload", mediaKind: "image", origin: "capture" });
  assert.equal(assetLibraryRevision(), before + 1);
  assert.deepEqual(assetLibraryChangesSince(before), [
    { collection: "upload", mediaKind: "image", origin: "capture" },
  ]);
});

test("asset invalidation only expires matching collection and media caches", () => {
  const changes = [{ collection: "hist", mediaKind: "video", origin: "tool" }];
  assert.equal(assetLibraryChangesAffectView("hist|video|||desc", changes), true);
  assert.equal(assetLibraryChangesAffectView("hist|image|||desc", changes), false);
  assert.equal(assetLibraryChangesAffectView("upload|video|||desc", changes), false);
  assert.equal(
    assetLibraryChangesAffectView("upload|doc|||asc", [{ collection: "all" }]),
    true,
  );
});
