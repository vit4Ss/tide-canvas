import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const rail = readFileSync(new URL("./studio-rail.tsx", import.meta.url), "utf8");
const users = readFileSync(new URL("../../app/admin/users/page.tsx", import.meta.url), "utf8");

test("generation and AI chat use independent front-menu permissions", () => {
  assert.match(rail, /href: "\/chat",[\s\S]*?label: "生成",[\s\S]*?key: "chat"/);
  assert.match(rail, /href: "\/ai-chat",[\s\S]*?label: "AI聊天",[\s\S]*?key: "ai_chat"/);
  assert.match(users, /\{ key: "chat", label: "生成" \},\s*\{ key: "ai_chat", label: "AI聊天" \}/);
});

test("the sidebar still filters every item through its own returned menu key", () => {
  assert.match(rail, /const menuAllowed = \(key: string\) =>[\s\S]*user\.menus\.includes\(key\)/);
  assert.match(rail, /const navTop = NAV_TOP\.filter\(\(item\) => menuAllowed\(item\.key\)\)/);
});
