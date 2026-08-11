import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node's native TypeScript loader requires the source suffix.
import { findActiveGenerationByPayload } from "./active-generation-dedupe.ts";

test("an identical active payload adopts the winning cross-tab request", () => {
  const rows = [
    { fingerprint: "payload-a:request-winner", payloadFingerprint: "payload-a", request: "winner" },
    { fingerprint: "payload-b:request-other", payloadFingerprint: "payload-b", request: "other" },
  ];

  assert.equal(findActiveGenerationByPayload(rows, "payload-a")?.request, "winner");
  assert.equal(findActiveGenerationByPayload(rows, "payload-c"), undefined);
});

test("pre-upgrade click-specific journal rows are still deduplicated", () => {
  const legacy = [{ fingerprint: "payload-a:legacy-request", request: "legacy" }];
  assert.equal(findActiveGenerationByPayload(legacy, "payload-a")?.request, "legacy");
});
