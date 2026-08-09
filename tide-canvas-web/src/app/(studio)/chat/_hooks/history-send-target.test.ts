import assert from "node:assert/strict";
import test from "node:test";

// 单行书写：@ts-expect-error 只覆盖下一行，多行 import 的 TS5097 报在模块
// 说明符那行会脱靶（还连带 TS2578 未使用指令）。
// @ts-expect-error Node's native TypeScript loader requires the source suffix.
import { historySendTargetMatches, isHistorySendTarget, type HistorySendTarget } from "./history-send-target.ts";

const target: HistorySendTarget = {
  conversationId: "31",
  draft: "生成一张海报",
  model: { id: "11", name: "Image Pro", modelKey: "image-pro", type: "image" },
  skillId: "21",
};

test("distinguishes a history target from ordinary UI event arguments", () => {
  assert.equal(isHistorySendTarget(target), true);
  assert.equal(isHistorySendTarget({ type: "click", target: {} }), false);
  assert.equal(isHistorySendTarget({ ...target, model: undefined }), false);
  assert.equal(isHistorySendTarget(undefined), false);
});

test("accepts only the exact committed history target", () => {
  assert.equal(historySendTargetMatches(target, {
    conversationId: target.conversationId,
    draft: target.draft,
    model: { ...target.model },
    skillId: target.skillId,
  }), true);
});

for (const [label, current] of [
  ["changed conversation", { conversationId: "32", draft: target.draft, model: { ...target.model }, skillId: target.skillId }],
  ["fallback model", { conversationId: target.conversationId, draft: target.draft, model: { ...target.model, id: "12" }, skillId: target.skillId }],
  ["missing catalog", { conversationId: target.conversationId, draft: target.draft, model: null, skillId: target.skillId }],
  ["changed skill", { conversationId: target.conversationId, draft: target.draft, model: { ...target.model }, skillId: "22" }],
  ["changed draft", { conversationId: target.conversationId, draft: "另一条提示词", model: { ...target.model }, skillId: target.skillId }],
] as const) {
  test(`rejects ${label}`, () => {
    assert.equal(historySendTargetMatches(target, current), false);
  });
}

test("accepts catalog metadata edits on the same model row", () => {
  assert.equal(historySendTargetMatches(target, {
    conversationId: target.conversationId,
    draft: target.draft,
    model: {
      ...target.model,
      name: "Image Pro 2",
      modelKey: "image-pro-v2",
      type: "video",
    },
    skillId: target.skillId,
  }), true);
});
