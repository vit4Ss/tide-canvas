import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const panel = readFileSync(new URL("./_components/skill-cover-ai-panel.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../../../styles/liuguang/admin.css", import.meta.url), "utf8");

test("skill cover AI uses an inline panel and fills the generated URL back into the form", () => {
  assert.match(page, /AI 生成/);
  assert.match(page, /<SkillCoverAiPanel/);
  assert.match(page, /coverUrl: url/);
  assert.match(panel, /className="adm-skill-cover-ai"/);
  assert.doesNotMatch(panel, /<AdminModal/);
});

test("skill cover AI submits a durable idempotent 16:9 text-to-image task", () => {
  assert.match(panel, /handler: "text_to_image"/);
  assert.match(panel, /aspectRatio: COVER_RATIO/);
  assert.match(panel, /requireDurableJournal: true/);
  assert.match(panel, /retainAccepted: true/);
  assert.match(panel, /dedupeActivePayload: true/);
  assert.match(panel, /modelPromptLimitIssue/);
  assert.match(panel, /commitAcceptedAiGeneration/);
});

test("skill cover AI handles completion, cancellation, fallback URLs, and editing races", () => {
  assert.match(panel, /AiTaskStatus\.SUCCESS/);
  assert.match(panel, /AiTaskStatus\.FAILED/);
  assert.match(panel, /AiTaskStatus\.CANCELLED/);
  assert.match(panel, /meta\?\.urls/);
  assert.match(panel, /aiApi\.cancelTask/);
  assert.match(page, /if \(coverAiBusy\)/);
  assert.match(page, /closeable=\{!coverAiBusy && !copyAiBusy\}/);
  assert.match(css, /adm-skill-cover-ai-grid/);
  assert.match(css, /prefers-reduced-motion/);
});
