import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const here = new URL(".", import.meta.url);
const read = (relative) => readFileSync(new URL(relative, here), "utf8");

test("popover select stays above the 3D editor and inside the viewport", () => {
  const select = read("./popover-select.tsx");

  assert.match(select, /z-\[260\]/);
  assert.doesNotMatch(select, /z-\[90\]/);
  assert.match(select, /window\.innerWidth - viewportPadding \* 2/);
  assert.match(select, /maxHeight: Math\.min\(288, availableHeight\)/);
  assert.match(select, /window\.addEventListener\("resize", reposition\)/);
  assert.match(select, /window\.addEventListener\("scroll", onScroll, true\)/);
  assert.match(select, /r\.bottom <= 0[\s\S]*close\(false\)/);
});

test("keyboard interaction is isolated and skips disabled options", () => {
  const select = read("./popover-select.tsx");

  assert.match(select, /e\.stopPropagation\(\)/);
  assert.match(select, /if \(!options\[index\]\?\.disabled\) return index/);
  assert.match(select, /scrollIntoView\(\{ block: "nearest" \}\)/);
  assert.match(select, /else if \(e\.key === "Tab"\)[\s\S]*close\(!e\.defaultPrevented\)/);
  assert.match(select, /aria-activedescendant=/);
  assert.match(select, /const effectiveActive = options\[active\]/);
  assert.match(select, /aria-describedby=\{ariaDescribedBy\}/);
  assert.match(select, /data-invalid=\{invalid \|\| undefined\}/);
  assert.match(select, /e\.key === "Home" \|\| e\.key === "End"/);
  assert.match(select, /typeaheadRef/);
  assert.match(select, /option\.label\.toLocaleLowerCase\(\)\.startsWith\(normalized\)/);
  assert.match(select, /if \(opt\.value !== value\) onChange\(opt\.value\)/);
  assert.match(select, /if \(disabled \|\| !opt \|\| opt\.disabled\) return/);
  assert.match(select, /const menuOpen = open && !disabled/);
  assert.match(select, /requestAnimationFrame\(\(\) => close\(false\)\)/);
  assert.match(select, /repeatedKey/);
  assert.match(select, /onMouseDown=\{\(event\) => event\.stopPropagation\(\)\}/);
  assert.doesNotMatch(select, /backdrop-blur/);
});

test("the clipped business selects use the portal component", () => {
  const select = read("./popover-select.tsx");
  const editor = read("../canvas/nodes/scene-3d-editor.tsx");
  const portrait = read("../canvas/nodes/shared/portrait-feature-panel.tsx");
  const stylePicker = read("../canvas/nodes/image-style-picker.tsx");
  const assetWorkspace = read("../studio/asset-skill-workspace.tsx");
  const skillFields = read("../skill/skill-input-fields.tsx");
  const skillRun = read("../skill/skill-run-panel.tsx");
  const focusTrap = read("../../hooks/use-focus-trap.ts");

  assert.match(editor, /label="运镜缓动方式"[\s\S]*tone="director"/);
  assert.match(editor, /label="截图画幅"[\s\S]*tone="director"/);
  assert.match(portrait, /label="输出清晰度"[\s\S]*minMenuWidth=\{88\}/);
  assert.match(stylePicker, /z-\[240\][\s\S]*label="风格分类"/);
  assert.match(assetWorkspace, /z-\[235\][\s\S]*<SkillInputFields/);
  assert.match(assetWorkspace, /<SkillInputFields[\s\S]*selectTone="dark"/);
  assert.match(assetWorkspace, /<SkillRunPanel[\s\S]*inputSelectTone="dark"/);
  assert.match(skillFields, /tone=\{selectTone\}/);
  assert.match(skillFields, /id=\{id\}[\s\S]*ariaDescribedBy=\{error \? errorId : undefined\}/);
  assert.match(skillRun, /selectTone=\{inputSelectTone\}/);
  assert.match(select, /data-focus-trap-anchor=\{menuId\}/);
  assert.match(select, /data-focus-trap-portal=\{menuId\}/);
  assert.match(focusTrap, /const focusOrigin = container\.contains\(activeEl\) \? activeEl : portalAnchor/);
});
