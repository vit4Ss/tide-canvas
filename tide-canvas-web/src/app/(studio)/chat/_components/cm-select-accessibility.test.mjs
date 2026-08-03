import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const selectSource = readFileSync(new URL("./cm-select.tsx", import.meta.url), "utf8");
const composerSource = readFileSync(new URL("./composer.tsx", import.meta.url), "utf8");

test("CmSelect exposes one coherent menu-button accessibility contract", () => {
  assert.match(selectSource, /aria-haspopup="menu"/);
  assert.match(selectSource, /role="menu"/);
  assert.match(selectSource, /aria-expanded=\{open\}/);
  assert.match(selectSource, /aria-controls=\{menuId\}/);
  assert.match(selectSource, /selected >= 0 \? selected : 0/);

  for (const key of ["ArrowDown", "ArrowUp", "Home", "End", "Escape", "Tab"]) {
    assert.match(selectSource, new RegExp(`event\\.key === "${key}"`));
  }
});

test("all composer options expose selection state without announcing decorative checks", () => {
  assert.equal((composerSource.match(/role="menuitemradio"/g) ?? []).length, 8);
  assert.equal((composerSource.match(/aria-checked=\{/g) ?? []).length, 8);
  assert.equal((composerSource.match(/className="ck" aria-hidden="true"/g) ?? []).length, 8);
});

test("closed menus are unmounted and close paths preserve the intended focus behavior", () => {
  assert.match(selectSource, /\{open \? \(/);
  assert.match(selectSource, /queueMicrotask\(\(\) => chipRef\.current\?\.focus\(\)\)/);
  assert.match(selectSource, /window\.setTimeout\(onToggle, 0\)/);
});
