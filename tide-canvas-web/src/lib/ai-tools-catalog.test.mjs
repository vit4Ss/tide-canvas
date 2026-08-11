import assert from "node:assert/strict";
import test from "node:test";
import { smartToolOriginLabel } from "./ai-tools-catalog.ts";

test("tool origin requires an exact canonical handler and toolKey pair", () => {
  assert.equal(smartToolOriginLabel("outpaint", { toolKey: "expand" }), "智能扩图");
  assert.equal(
    smartToolOriginLabel("outpaint", { toolKey: "expand", toolTitle: "扩展画布" }),
    "扩展画布",
  );
  assert.equal(smartToolOriginLabel("outpaint", {}), undefined);
  assert.equal(smartToolOriginLabel("image_to_image", { toolKey: "expand" }), undefined);
  assert.equal(smartToolOriginLabel("image_to_image", "not json"), undefined);
});
