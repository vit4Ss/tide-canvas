import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const here = new URL(".", import.meta.url);
const read = (relative) => readFileSync(new URL(relative, here), "utf8");

test("AI task create is durably journaled before POST and accepted tasks are retained", () => {
  const source = read("./ai-generation-idempotency.ts");
  const durableFence = source.indexOf("options.requireDurableJournal && !prepared.durable");
  const paidPost = source.indexOf('http.post<AiTaskVO>("/api/ai/generate"');
  const acceptedWrite = source.indexOf("result.success && result.data?.id && options.retainAccepted");

  assert.ok(durableFence >= 0, "durable journal fence must exist");
  assert.ok(paidPost > durableFence, "the paid POST must be after the durable fence");
  assert.ok(acceptedWrite > paidPost, "a successful create must become an accepted journal");
  assert.match(source, /options\.requireDurableJournal[\s\S]*!navigator\.locks/);
  assert.match(source, /export async function commitAcceptedAiGeneration/);
  assert.match(source, /payload\?: Omit<AiGenerateDTO, "clientRequestId">/);
});

test("paid SkillRun mutations fail closed while cancel remains available", () => {
  const source = read("./skill-run-api.ts");
  const durableFence = source.indexOf("if (requireDurable && !prepared.durable) return journalUnavailableResult<TResult>()");
  const send = source.indexOf("const result = await send(");

  assert.ok(durableFence >= 0, "SkillRun durable fence must exist");
  assert.ok(send > durableFence, "no paid SkillRun mutation may precede the durable fence");
  assert.match(source, /localStorage\.getItem\(pendingStorageKey\(scope\)\)/);
  assert.match(source, /dto\.action !== "cancel"/);
  assert.match(source, /requireDurable[\s\S]*!navigator\.locks/);
  assert.match(source, /code >= 500 && code <= 599/, "business result codes must not be retried as 5xx");
});

test("tool and Studio surfaces commit only after retaining a recovery path", () => {
  const tool = read("../app/tools/[op]/page.tsx");
  const studio = read("../components/studio/create-studio/use-generation.ts");

  assert.doesNotMatch(tool, /if \(n > 150\)/, "foreground timeout must not mark a processing task failed");
  assert.match(tool, /任务仍在后台处理中，本页会自动同步结果/);
  assert.match(tool, /recoverableAiGenerations\(journalScope, ownerUserId\)/);

  const foregroundDecision = studio.indexOf("const makeForeground =");
  const persist = studio.indexOf("persistActiveRun(run)", foregroundDecision);
  const drive = studio.indexOf("driveRun(run, makeForeground)", persist);
  const terminalCommit = studio.indexOf("void commitAcceptedAiGeneration(run.journalScope, taskId, run.ownerUserId)");
  assert.ok(
    foregroundDecision >= 0 && persist > foregroundDecision && drive > persist,
    "Studio must decide and persist the foreground recovery pointer before polling",
  );
  assert.ok(terminalCommit >= 0, "Studio must retain the accepted journal until terminal cleanup");
  assert.match(studio, /clientRequestId: entry\.clientRequestId/);
});

test("paid AI recovery is account-partitioned and storage deletion beats stale tab memory", () => {
  const journal = read("./ai-generation-idempotency.ts");
  const tool = read("../app/tools/[op]/page.tsx");
  const studio = read("../components/studio/create-studio/use-generation.ts");
  const music = read("./music-modes.ts");

  assert.match(journal, /ownerUserId\?: string/);
  assert.match(journal, /return owner \? `user:\$\{owner\}:\$\{scope\}` : scope/);
  assert.match(journal, /!ownerUserId \|\| typeof navigator === "undefined" \|\| !navigator\.locks/);
  const aiRead = journal.slice(journal.indexOf("function readPending("), journal.indexOf("function writePending("));
  assert.ok(aiRead.indexOf("localStorage.getItem") < aiRead.lastIndexOf("return fallback"));
  assert.doesNotMatch(aiRead, /for \(const row of pendingMemory/);
  assert.match(tool, /ownerUserId,/);
  assert.match(studio, /activeRunStorageKey\(ownerUserId\)/);
  assert.match(studio, /saved\.ownerUserId !== ownerUserId/);
  assert.match(music, /recoverableAiGenerations\(scope, ownerUserId\)/);
});

test("SkillRun pending TTL, cross-tab authority and active pointer commit are fenced", () => {
  const api = read("./skill-run-api.ts");
  const canvasRuns = read("../components/canvas/skill-run/use-skill-runs.ts");
  const genericRun = read("../components/skill/use-skill-run.ts");
  const asset = read("../components/studio/asset-skill-workspace.tsx");

  assert.match(api, /Date\.now\(\) - row\.updatedAt < \(row\.resultId \? RESOLVED_CREATE_TTL_MS : PENDING_TTL_MS\)/);
  const skillRead = api.slice(api.indexOf("function readPending("), api.indexOf("function writePending("));
  assert.doesNotMatch(skillRead, /for \(const row of pendingMemory/);
  assert.match(canvasRuns, /durablePendingCreateRequestIds/);
  assert.match(genericRun, /navigator\.locks\.request\(lockName/);
  assert.match(genericRun, /const durablePointer = await persist\(result\.data\)/);
  assert.match(genericRun, /if \(durablePointer\) await skillRunApi\.commitCreate/);
  assert.match(genericRun, /`\$\{storageKey\}:user:\$\{encodeURIComponent\(owner\)\}`/);
  assert.match(asset, /ownerUserId,/);
});

test("ambiguous SkillRun lookup misses retain the original request id", () => {
  const source = read("../components/canvas/skill-run/use-skill-runs.ts");
  assert.match(source, /A successful empty lookup is still not proof/);
  assert.doesNotMatch(source, /CREATE_RECONCILE_MAX_MISSES/);
  assert.match(source, /AMBIGUOUS_CREATE_POLL_INTERVAL_MS/);
});
