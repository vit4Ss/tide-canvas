import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relative) => readFileSync(new URL(relative, import.meta.url), "utf8");
const updater = read("./app-auto-update.tsx");
const guard = read("../../hooks/use-app-update-guard.ts");
const route = read("../../app/app-version/route.ts");
const layout = read("../../app/layout.tsx");
const chat = read("../../app/(studio)/chat/page.tsx");
const studio = read("../studio/create-studio.tsx");
const canvas = read("../../app/(canvas)/canvas/[id]/page.tsx");
const dockerfile = read("../../../Dockerfile");
const workflow = read("../../../../.github/workflows/docker-images.yml");

test("部署版本经过两次确认后自动安全重载", () => {
  assert.match(updater, /fetch\(`\/app-version\?t=\$\{Date\.now\(\)\}`/);
  assert.match(updater, /if \(confirmations >= 2\) attemptReload\(deployed\)/);
  assert.match(updater, /new Event\(APP_UPDATE_CAN_RELOAD_EVENT, \{ cancelable: true \}\)/);
  assert.match(updater, /if \(!window\.dispatchEvent\(guardEvent\)\)/);
  assert.ok(updater.indexOf("new CustomEvent(APP_UPDATE_BEFORE_RELOAD_EVENT") < updater.indexOf("reloadAttemptAllowed(target)"));
  assert.match(updater, /detail: \{ targetVersion: target \}/);
  assert.match(updater, /if \(!window\.dispatchEvent\(persistEvent\)\)/);
  assert.match(updater, /window\.location\.reload\(\)/);
  assert.match(updater, /marker\.count >= 3/);
  assert.match(route, /Cache-Control[\s\S]*?no-cache, no-store/);
  assert.match(layout, /<AppAutoUpdate \/>/);
});

test("付费提交期间阻止重载并在重载前保存草稿", () => {
  assert.match(guard, /const canReload = \(event: Event\)/);
  assert.match(guard, /if \(blockedRef\.current\) event\.preventDefault\(\)/);
  assert.match(guard, /const beforeUpdate = \(event: Event\) => \{[\s\S]*?persistRef\.current\(targetVersion\)/);
  assert.match(guard, /catch \{[\s\S]*?event\.preventDefault\(\)/);
  assert.match(chat, /useAppUpdateGuard\([\s\S]*?refsApi\.refs\.some\(\(ref\) => ref\.uploading\)/);
  assert.match(chat, /CHAT_AUTO_UPDATE_DRAFT_KEY[\s\S]*?references:/);
  assert.match(chat, /saved\.targetVersion === CURRENT_APP_VERSION/);
  assert.match(chat, /model: models\.model,[\s\S]*?music: cfg\.music,[\s\S]*?toolSkill,/);
  assert.match(chat, /restoreReferencesIfEmpty\(saved\.references\)/);
  assert.match(studio, /const updateBlocked = submitting \|\| validatingReferences \|\| optimizing/);
  assert.match(studio, /STUDIO_AUTO_UPDATE_DRAFT_KEY[\s\S]*?slotData,[\s\S]*?skill,/);
  assert.match(studio, /isFreshUpdateSnapshot\(saved\.savedAt\)/);
  assert.match(studio, /saved\.targetVersion === CURRENT_APP_VERSION/);
  assert.match(studio, /sourceClipId: clip\.sourceClipId,[\s\S]*?extraClips: clip\.extraClips/);
  assert.match(canvas, /useAppUpdateGuard\(!loaded \|\| saveConflict \|\| editingName/);
  assert.match(canvas, /void saveRef\.current\(true\)[\s\S]*?throw new Error\("canvas save pending"\)/);
  assert.match(updater, /dirtyPath === pathname/);
  assert.match(updater, /pathname !== "\/canvas\/new"/);
  assert.match(updater, /input, textarea, select, \[contenteditable='true'\]/);
});

test("CI 将提交 SHA 注入前端镜像作为稳定版本", () => {
  assert.match(dockerfile, /ARG NEXT_PUBLIC_APP_VERSION=development/);
  assert.match(dockerfile, /NEXT_PUBLIC_APP_VERSION=\$NEXT_PUBLIC_APP_VERSION/);
  assert.match(workflow, /NEXT_PUBLIC_APP_VERSION=\$\{\{ github\.sha \}\}/);
});
