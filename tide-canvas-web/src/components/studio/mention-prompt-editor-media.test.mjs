import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./mention-prompt-editor.tsx", import.meta.url), "utf8");
const studioSource = readFileSync(new URL("./create-studio.tsx", import.meta.url), "utf8");
const lightboxSource = readFileSync(new URL("./create-studio/lightbox.tsx", import.meta.url), "utf8");

test("聚焦输入时引用 URL 更新会原位刷新 pill，不重建 contentEditable", () => {
  assert.match(
    source,
    /if \(isEcho && !sigSame && focusedRef\.current\) \{[\s\S]*?syncMentionPillMedia\(editor, refs, previewImages\)[\s\S]*?return;/,
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
    /onCompositionEnd=\{\(\) => \{[\s\S]*?pendingRefsSyncRef\.current[\s\S]*?syncMentionPillMedia\(editor, refs, previewImages\)/,
  );
});

test("引用缩略图加载失败时使用稳定字形，不显示浏览器破图图标", () => {
  assert.match(source, /image\.addEventListener\("error"[\s\S]*?image\.replaceWith\(createPillGlyph\("image"\)\)/);
  assert.match(source, /<MentionMenuMedia refItem=\{r\} \/>/);
});

test("创作台可为图片引用启用点击放大，同时不影响未启用预览的共用编辑器", () => {
  assert.match(source, /onPreviewRef\?: \(ref: MentionRef\) => void/);
  assert.match(source, /previewImages && ref\.kind === "image" && !!ref\.thumb/);
  assert.match(source, /pill\.classList\.toggle\("zoomable", previewable\)/);
  assert.match(source, /if \(previewRefFromTarget\(e\.target\)\) e\.preventDefault\(\)/);
  assert.match(source, /if \(ref\) onPreviewRef\?\.\(ref\)/);
  assert.match(studioSource, /onPreviewRef=\{previewReference\}/);
  assert.match(studioSource, /referenceLightbox && \([\s\S]*?<Lightbox[\s\S]*?url=\{referenceLightbox\.url\}/);
  assert.match(lightboxSource, /onTool\?: \(act: string\) => void/);
  assert.match(lightboxSource, /\{onTool && \([\s\S]*?className="gen-acts ws-lb-tools"/);
});
