import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const node=readFileSync(new URL("./image-node.tsx",import.meta.url),"utf8");
const modal=readFileSync(new URL("./image-inpaint-modal.tsx",import.meta.url),"utf8");
const tools=readFileSync(new URL("../../../app/tools/[op]/page.tsx",import.meta.url),"utf8");
const adminModels=readFileSync(new URL("../../../app/admin/models/page.tsx",import.meta.url),"utf8");

test("canvas local edit rolls back only definitely rejected placeholder nodes",()=>{
  assert.match(node,/key: "image\.inpaint"[\s\S]*?setInpaintOpen\(true\)/);
  assert.match(node,/rollbackOnRejected && result\.status === "rejected"[\s\S]*?removeNode\(nid, false\)/);
  assert.match(node,/rollbackOnRejected: true/);
  assert.match(node,/displayPrompt: String\(input\.prompt\)/);
  assert.doesNotMatch(node,/rollbackOnRejected && result\.status === "ambiguous"/);
});

test("character local editing portal remains independent from toolbar visibility",()=>{
  assert.match(node,/\{inpaintOpen && node\.imageSrc && \(/);
  assert.doesNotMatch(node,/showAuxUI && inpaintOpen/);
});

test("mask UI sends the displayed model and price and removes only unused new masks",()=>{
  assert.match(modal,/typeof document === "undefined"\) return null/);
  assert.match(modal,/withTimeout\([\s\S]*?marketApi\.studioModels\("image"\)[\s\S]*?蒙版模型读取超时/);
  assert.match(modal,/imageTimeout = setTimeout\(\(\) => loadController\.abort\(\), LOAD_TIMEOUT_MS\)/);
  assert.match(modal,/expectedPointCost:cost[\s\S]*?expectedMaskModelId:model\.id/);
  assert.match(modal,/MAX_MASK_UPLOAD_BYTES = 32 \* 1024 \* 1024/);
  assert.match(modal,/uploadedMask&&!uploadedMask\.reused&&!accepted[\s\S]*?fileApi\.delete/);
  assert.match(modal,/sourceBrushSize\(size,source\.width,e\.currentTarget\.getBoundingClientRect\(\)\.width\)/);
  assert.match(modal,/闭合圈选会自动填充/);
});

test("mask editor follows the canvas modal theme instead of a fixed black panel",()=>{
  assert.match(modal,/data-canvas-modal="true"/);
  assert.match(modal,/bg-white text-neutral-900[\s\S]*?dark:bg-\[#29292b\] dark:text-white/);
  assert.match(modal,/bg-black\/45[\s\S]*?backdrop-blur-sm/);
  assert.doesNotMatch(modal,/bg-black\/75/);
  assert.doesNotMatch(modal,/bg-cyan-300/);
});

test("mask editor hides technical model settings and shows only the point cost",()=>{
  assert.match(modal,/本次消耗[\s\S]*?\{cost\} 积分[\s\S]*?"生成修改"/);
  assert.doesNotMatch(modal,/局部重绘模型：/);
  assert.doesNotMatch(modal,/aria-label="输出清晰度"/);
  assert.doesNotMatch(modal,/aria-label="输出质量"/);
  assert.doesNotMatch(modal,/\{source\.width\} × \{source\.height\}/);
});

test("tool page keeps the mask editor open until a task is accepted",()=>{
  assert.match(tools,/const started = await run\([\s\S]*?if \(started !== true\) throw/);
  assert.doesNotMatch(tools,/setMaskOpen\(false\);\s*await run/);
});

test("switching away from an image model cannot retain a hidden mask capability",()=>{
  assert.match(adminModels,/if \(next !== "image"\) setC\(\{ imagePrimary: false, supportsMask: false \}\)/);
  assert.match(adminModels,/supportsMask: type === "image" && cfg\.supportsMask === true/);
});
