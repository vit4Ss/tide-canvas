import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(new URL("./toast.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("./toast.module.css", import.meta.url), "utf8");
const canvasLayout = readFileSync(new URL("../../app/(canvas)/layout.tsx", import.meta.url), "utf8");

test("global toasts use distinct friendly identities instead of tinted library defaults", () => {
  assert.match(component, /success: \{ Icon: Check, label: "完成啦", ariaLabel: "成功" \}/);
  assert.match(component, /error: \{ Icon: TriangleAlert, label: "遇到问题", ariaLabel: "错误" \}/);
  assert.match(component, /info: \{ Icon: Info, label: "提醒一下", ariaLabel: "提醒" \}/);
  assert.match(component, /styles\.content[\s\S]*?styles\.title[\s\S]*?styles\.message/);
  assert.doesNotMatch(component, /bg-green-50|bg-red-50|bg-blue-50|const COLORS/);
  assert.match(styles, /\.success \{[\s\S]*?--toast-accent: #3f8a65/);
  assert.match(styles, /\.info \{[\s\S]*?--toast-accent: #6673a8/);
  assert.match(styles, /\.error \{[\s\S]*?--toast-accent: #a9584f/);
  assert.match(styles, /\.success \.icon[\s\S]*?border-radius: 50%/);
  assert.match(styles, /\.info \.icon[\s\S]*?border-radius: 9px 9px 4px 9px/);
  assert.match(styles, /\.error \.icon[\s\S]*?border-radius: 9px 4px 9px 9px/);
  assert.doesNotMatch(styles, /linear-gradient|radial-gradient|backdrop-filter|rotate\(/);
});

test("toast lifetime pauses accessibly and closes with a short exit transition", () => {
  assert.match(component, /remainingRef = useRef\(duration\)/);
  assert.match(component, /if \(paused \|\| closing\) return/);
  assert.match(component, /remainingRef\.current = Math\.max\(0,/);
  assert.match(component, /setClosing\(true\)[\s\S]*?window\.setTimeout\(\(\) => onRemove\(item\.id\), 180\)/);
  assert.doesNotMatch(component, /styles\.life|--toast-life/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});

test("toast layout adapts to dark themes, long errors, safe areas, and phones", () => {
  assert.match(styles, /top: max\(18px, calc\(env\(safe-area-inset-top\) \+ 10px\)\)/);
  assert.match(styles, /max-width: min\(600px, calc\(100vw - 24px\)\)/);
  assert.match(styles, /:global\(\.dark\) \.card/);
  assert.match(styles, /:global\(body\.canvas-route\) \.card/);
  assert.match(styles, /:global\(body\.imini\) \.card/);
  assert.match(canvasLayout, /classList\.add\("canvas-route"\)[\s\S]*?classList\.remove\("canvas-route"\)/);
  assert.match(styles, /@media \(max-width: 480px\)[\s\S]*?width: 100%/);
});

test("toast stacking merges consecutive duplicates and stays bounded", () => {
  assert.match(component, /const MAX_VISIBLE_TOASTS = 4/);
  assert.match(component, /last\?\.type === item\.type && last\.message === item\.message/);
  assert.match(component, /next\.slice\(-MAX_VISIBLE_TOASTS\)/);
});
