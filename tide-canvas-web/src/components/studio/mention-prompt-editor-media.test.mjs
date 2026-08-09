import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./mention-prompt-editor.tsx", import.meta.url), "utf8");

test("聚焦输入时引用 URL 更新会原位刷新 pill，不重建 contentEditable", () => {
  assert.match(
    source,
    /if \(isEcho && !sigSame && focusedRef\.current\) \{[\s\S]*?syncMentionPillMedia\(editor, refs\)[\s\S]*?return;/,
  );
  assert.match(source, /current\.getAttribute\("src"\) !== ref\.thumb[\s\S]*?current\.src = ref\.thumb/);
});

test("输入法组字期间不替换 pill DOM，组字结束后再刷新媒体", () => {
  const composingBranch = source.match(
    /if \(composingRef\.current\) \{([\s\S]*?)\n      \}/,
  )?.[1] ?? "";
  assert.match(composingBranch, /pendingRefsSyncRef\.current = true/);
  assert.doesNotMatch(composingBranch, /syncMentionPillMedia/);
  assert.match(
    source,
    /onCompositionEnd=\{\(\) => \{[\s\S]*?pendingRefsSyncRef\.current[\s\S]*?syncMentionPillMedia\(editor, refs\)/,
  );
});

test("引用缩略图加载失败时使用稳定字形，不显示浏览器破图图标", () => {
  assert.match(source, /image\.addEventListener\("error"[\s\S]*?image\.replaceWith\(createPillGlyph\("image"\)\)/);
  assert.match(source, /<MentionMenuMedia refItem=\{r\} \/>/);
});
