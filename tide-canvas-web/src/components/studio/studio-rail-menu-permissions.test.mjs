import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const rail = readFileSync(new URL("./studio-rail.tsx", import.meta.url), "utf8");
const users = readFileSync(new URL("../../app/admin/users/page.tsx", import.meta.url), "utf8");

test("generation keeps its own front-menu permission", () => {
  assert.match(rail, /href: "\/chat",[\s\S]*?label: "生成",[\s\S]*?key: "chat"/);
  assert.match(users, /\{ key: "chat", label: "生成" \}/);
});

// The embedded AI chat page was removed; its API (the chat gateway) is used
// from clients such as Codex, not from a sidebar entry. Neither the rail nor
// the roles admin may keep offering the dead entry.
test("the removed AI chat entry is gone from the rail and the roles admin", () => {
  assert.doesNotMatch(rail, /\/ai-chat|ai_chat/);
  assert.doesNotMatch(users, /ai_chat|AI聊天/);
});

test("the sidebar still filters every item through its own returned menu key", () => {
  assert.match(rail, /const menuAllowed = \(key: string\) =>[\s\S]*user\.menus\.includes\(key\)/);
  assert.match(rail, /const navTop = NAV_TOP\.filter\(\(item\) => menuAllowed\(item\.key\)\)/);
});
