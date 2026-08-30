import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(new URL("./toast.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("./toast.module.css", import.meta.url), "utf8");

test("global toasts use distinct friendly identities instead of tinted library defaults", () => {
  assert.match(component, /success: \{ Icon: Check, label: "成功" \}/);
  assert.match(component, /error: \{ Icon: TriangleAlert, label: "错误" \}/);
  assert.match(component, /info: \{ Icon: Info, label: "提醒" \}/);
  assert.doesNotMatch(component, /bg-green-50|bg-red-50|bg-blue-50|const COLORS/);
  assert.match(styles, /\.success \{[\s\S]*?--toast-accent: #55ad82/);
  assert.match(styles, /\.info \{[\s\S]*?--toast-accent: #7384d2/);
  assert.match(styles, /\.error \{[\s\S]*?--toast-accent: #df7669/);
  assert.match(styles, /\.success \.icon[\s\S]*?border-radius: 50%/);
  assert.match(styles, /\.info \.icon[\s\S]*?border-radius: 12px 12px 5px 12px/);
  assert.match(styles, /\.error \.icon[\s\S]*?border-radius: 12px 5px 12px 12px/);
});

test("toast lifetime pauses accessibly and closes with a short exit transition", () => {
  assert.match(component, /remainingRef = useRef\(duration\)/);
  assert.match(component, /if \(paused \|\| closing\) return/);
  assert.match(component, /remainingRef\.current = Math\.max\(0,/);
  assert.match(component, /setClosing\(true\)[\s\S]*?window\.setTimeout\(\(\) => onRemove\(item\.id\), 180\)/);
  assert.match(styles, /\.paused \.life::after[\s\S]*?animation-play-state: paused/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});

test("toast layout adapts to dark themes, long errors, safe areas, and phones", () => {
  assert.match(styles, /top: max\(18px, calc\(env\(safe-area-inset-top\) \+ 10px\)\)/);
  assert.match(styles, /max-width: min\(720px, calc\(100vw - 24px\)\)/);
  assert.match(styles, /:global\(\.dark\) \.card/);
  assert.match(styles, /:global\(body\.imini\) \.card/);
  assert.match(styles, /@media \(max-width: 480px\)[\s\S]*?width: 100%/);
});

test("toast stacking merges consecutive duplicates and stays bounded", () => {
  assert.match(component, /const MAX_VISIBLE_TOASTS = 4/);
  assert.match(component, /last\?\.type === item\.type && last\.message === item\.message/);
  assert.match(component, /next\.slice\(-MAX_VISIBLE_TOASTS\)/);
});
