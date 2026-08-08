import assert from "node:assert/strict";
import test from "node:test";

import type { StudioModelVO } from "@/lib/market-api";
// @ts-expect-error Node's native TypeScript loader requires the source suffix.
import { historicalModelOf } from "./history-model.ts";

function catalogModel(id: string, name: string, modelKey: string, type = "image"): StudioModelVO {
  return { id, name, modelKey, type, desc: "", pointCost: "1", config: null };
}

const models = [
  catalogModel("11", "Image Pro", "image-pro"),
  catalogModel("12", "Image Pro", "image-pro-copy"),
];

test("prefers the stable model row id even when names are duplicated", () => {
  assert.equal(historicalModelOf({
    modelRowId: "12",
    model: "Image Pro",
    modelKey: "image-pro",
    type: "image",
  }, models)?.id, "12");
});

test("uses a linked task model id for legacy history params", () => {
  assert.equal(historicalModelOf({ model: "old label", type: "image" }, models, "11")?.id, "11");
});

test("treats a zero task model id as missing and falls back to the legacy model key", () => {
  assert.equal(historicalModelOf({ modelKey: "image-pro", type: "image" }, models, "0")?.id, "11");
});

test("does not substitute a look-alike model when a known row id is unavailable", () => {
  assert.equal(historicalModelOf({
    modelRowId: "99",
    model: "Image Pro",
    modelKey: "image-pro",
    type: "image",
  }, models), undefined);
});
