import assert from "node:assert/strict";
import test from "node:test";

import {
  chronologicalTailPageNumbers,
  loadLatestChronologicalMessageTail,
  mergeChronologicalMessageTail,
} from "./chat-message-tail.ts";

function successPage(records, total, pageNum, pageSize = 100) {
  return {
    success: true,
    code: 200,
    message: "ok",
    data: {
      records,
      total,
      pageNum,
      pageSize,
      pages: Math.max(1, Math.ceil(total / pageSize)),
    },
    timestamp: 1,
  };
}

function rows(from, to) {
  return Array.from({ length: Math.max(0, to - from + 1) }, (_, index) => ({
    id: String(from + index),
  }));
}

test("calculates the physical pages intersecting an ASC tail", () => {
  assert.deepEqual(chronologicalTailPageNumbers(150, 100), [1, 2]);
  assert.deepEqual(chronologicalTailPageNumbers(200, 100), [2]);
  assert.deepEqual(chronologicalTailPageNumbers(201, 100), [2, 3]);
});

test("merges unordered pages, deduplicates ids, and preserves chronology", () => {
  const merged = mergeChronologicalMessageTail([
    successPage([{ id: "103", version: "new" }, { id: "104" }], 4, 3, 3).data,
    successPage([{ id: "101" }, { id: "102" }, { id: "103", version: "old" }], 4, 2, 3).data,
  ], 4);

  assert.deepEqual(merged.map((row) => row.id), ["101", "102", "103", "104"]);
  assert.equal(merged[2].version, "new");
});

for (const total of [150, 200, 201]) {
  test(`returns exactly the newest 100 of ${total} stable rows`, async () => {
    const allRows = rows(1, total);
    const requestedPages = [];
    const result = await loadLatestChronologicalMessageTail(async (pageNum, pageSize) => {
      requestedPages.push(pageNum);
      const offset = (pageNum - 1) * pageSize;
      return successPage(allRows.slice(offset, offset + pageSize), total, pageNum, pageSize);
    }, 100);

    assert.equal(result.success, true);
    assert.equal(result.data.records.length, 100);
    assert.equal(result.data.records[0].id, String(total - 99));
    assert.equal(result.data.records.at(-1)?.id, String(total));
    assert.deepEqual(requestedPages, total === 201 ? [1, 2, 3] : [1, 2]);
  });
}

test("follows a last-page boundary crossed by a concurrent append", async () => {
  const requestedPages = [];
  const result = await loadLatestChronologicalMessageTail(async (pageNum, pageSize) => {
    requestedPages.push(pageNum);
    if (pageNum === 1) return successPage(rows(1, 100), 200, 1, pageSize);
    if (pageNum === 2) return successPage(rows(101, 200), 201, 2, pageSize);
    return successPage([{ id: "201" }], 201, 3, pageSize);
  }, 100);

  assert.deepEqual(requestedPages, [1, 2, 3]);
  assert.equal(result.data.records.length, 100);
  assert.equal(result.data.records[0].id, "102");
  assert.equal(result.data.records.at(-1)?.id, "201");
  assert.equal(result.data.total, 201);
  assert.equal(result.data.pages, 3);
});
