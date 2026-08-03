import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error Node's native TypeScript loader requires the source suffix.
import { historySendTargetMatches, type HistorySendTarget } from "./history-send-target.ts";

const target: HistorySendTarget = {
  conversationId: "31",
  draft: "生成一张海报",
  model: { id: "11", name: "Image Pro", modelKey: "image-pro", type: "image" },
  skillId: "21",
};

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
  ["renamed catalog row", { conversationId: target.conversationId, draft: target.draft, model: { ...target.model, name: "Image Pro 2" }, skillId: target.skillId }],
  ["missing catalog", { conversationId: target.conversationId, draft: target.draft, model: null, skillId: target.skillId }],
  ["changed skill", { conversationId: target.conversationId, draft: target.draft, model: { ...target.model }, skillId: "22" }],
  ["changed draft", { conversationId: target.conversationId, draft: "另一条提示词", model: { ...target.model }, skillId: target.skillId }],
] as const) {
  test(`rejects ${label}`, () => {
    assert.equal(historySendTargetMatches(target, current), false);
  });
}
