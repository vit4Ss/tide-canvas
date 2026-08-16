import assert from "node:assert/strict";
import test from "node:test";
import { parseCanvasDocument } from "./canvas-document.ts";

test("missing graph arrays remain compatible with an empty legacy document", () => {
  assert.deepEqual(parseCanvasDocument("{}"), {
    nodes: [],
    connections: [],
    groups: [],
  });
});

test("valid JSON with a malformed canvas envelope is rejected", () => {
  for (const raw of ["[]", '"canvas"', '{"nodes":{}}', '{"connections":"bad"}']) {
    assert.throws(() => parseCanvasDocument(raw));
  }
});

test("legacy skillRunState is promoted without changing its contents", () => {
  assert.deepEqual(
    parseCanvasDocument('{"nodes":[],"connections":[],"skillRunState":{"trackedRunIds":["run-1"]}}'),
    {
      nodes: [],
      connections: [],
      groups: [],
      skillRuns: { trackedRunIds: ["run-1"] },
    },
  );
});
