import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sendSource = readFileSync(new URL("./use-send-message.ts", import.meta.url), "utf8");
const resumeSource = readFileSync(new URL("./use-resume-stream.ts", import.meta.url), "utf8");
const conversationsSource = readFileSync(new URL("./use-conversations.ts", import.meta.url), "utf8");
const apiSource = readFileSync(new URL("../../../../lib/chat-api.ts", import.meta.url), "utf8");

test("text retry credentials outlive the server lease and the journal stays bounded", () => {
  assert.match(sendSource, /PENDING_TEXT_TURN_PROTECTED_MS\s*=\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
  assert.match(sendSource, /PENDING_TEXT_TURN_MAX_AGE_MS\s*=\s*30\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
  assert.match(sendSource, /PENDING_TEXT_TURN_MAX_ENTRIES\s*=\s*64/);
  assert.match(sendSource, /function prunePendingTextTurns/);
  assert.match(sendSource, /PENDING_TEXT_TURN_MAX_ENTRIES - protectedRows\.length/);
  assert.match(sendSource, /nextRows\.length > PENDING_TEXT_TURN_MAX_ENTRIES/);
});

test("successful conversation deletion removes its local recovery credentials", () => {
  assert.match(sendSource, /export async function clearPendingChatTurnsForConversation/);
  assert.match(conversationsSource, /await clearPendingChatTurnsForConversation\(c\.id\)/);
});

test("a media turn blocked by an active text lease keeps retrying the same task", () => {
  assert.match(sendSource, /isAmbiguousFailure\(result\.code\) \|\| isConversationBusy\(result\.code\)/);
  assert.match(sendSource, /当前对话正在生成，任务已保留，稍后会自动写入对话/);
});

test("live reconnect is scoped to the orphaned user message request id", () => {
  assert.match(resumeSource, /resumeRequestId\s*=\s*resumeId\s*\?\s*lastMsg\.clientRequestId/);
  assert.match(resumeSource, /clientRequestId:\s*resumeRequestId/);
  assert.match(resumeSource, /LIVE_RESUME_WINDOW_MS\s*=\s*12\s*\*\s*60\s*\*\s*1000/);
  assert.match(apiSource, /clientRequestId=\$\{encodeURIComponent\(handlers\.clientRequestId\)\}/);
});
