import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const picker = readFileSync(new URL("./model-picker.tsx", import.meta.url), "utf8");
const brand = readFileSync(new URL("../../../lib/model-brand.ts", import.meta.url), "utf8");
const quickStart = readFileSync(new URL("../canvas-quick-start.tsx", import.meta.url), "utf8");
const canvasConsumers = [
  ["project launcher", "../canvas-quick-start.tsx", "./nodes/model-picker"],
  ["canvas assistant", "../canvas-assistant-panel.tsx", "./nodes/model-picker"],
  ["image node", "./image-node.tsx", "./model-picker"],
  ["video node", "./video-node.tsx", "./model-picker"],
  ["text node", "./text-node.tsx", "./model-picker"],
  ["audio node", "./audio-node.tsx", "./model-picker"],
];

const compiledBrand = ts.transpileModule(brand, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const brandModule = { exports: {} };
const testRequire = (id) => {
  if (id === "./swatch") {
    return { grayscaleSwatch: (seed, tone) => `fallback:${seed}:${tone}` };
  }
  throw new Error(`Unexpected import in model-brand.ts: ${id}`);
};
new Function("require", "module", "exports", compiledBrand)(testRequire, brandModule, brandModule.exports);
const { isIconUrl, matchBrandIcon, resolveModelSwatch } = brandModule.exports;

test("canvas model picker resolves configured and inferred brand icons", () => {
  assert.match(picker, /import \{ resolveModelSwatch \} from "@\/lib\/model-brand"/);
  assert.match(picker, /resolveModelSwatch\(\{[\s\S]*?name: model\.name,[\s\S]*?modelKey: model\.modelId,[\s\S]*?icon: model\.icon/);
  assert.match(picker, /<ModelGlyph model=\{model\} className="h-9 w-9 rounded-lg text-\[12px\]" \/>/);
});

test("shared resolver matches the reported model brands", () => {
  assert.equal(matchBrandIcon("seedance-1.5-pro"), "/model-icons/bytedance.png");
  assert.equal(matchBrandIcon("Grok 4", "xAI"), "/model-icons/grok.png");
  assert.equal(matchBrandIcon("x-ai/model-1"), "/model-icons/grok.png");
  assert.equal(matchBrandIcon("PixAI Pro"), null);
});

test("shared resolver trims image URLs and safely handles SVG forms", () => {
  assert.equal(isIconUrl("  data:image/png;base64,AAAA  "), true);
  assert.equal(isIconUrl("HTTPS://example.com/model.png"), true);

  const remote = resolveModelSwatch({ name: "Grok 4", icon: " HTTPS://example.com/custom.png " });
  assert.equal(remote.glyph, "");
  assert.match(remote.style.background, /example\.com\/custom\.png/);
  assert.doesNotMatch(remote.style.background, /model-icons\/grok/);

  const emoji = resolveModelSwatch({ name: "Custom", icon: " 🎬 " });
  assert.equal(emoji.glyph, "🎬");
  assert.equal(emoji.style.background, "fallback:Custom:light");

  const dataSvg = resolveModelSwatch({
    name: "Custom",
    icon: ' data:image/svg+xml,<svg viewBox="0 0 10 10"><path fill="#000"/></svg> ',
  });
  assert.equal(dataSvg.glyph, "");
  assert.match(dataSvg.style.background, /data:image\/svg\+xml,%3Csvg/);
  assert.doesNotMatch(dataSvg.style.background, /<svg/);

  const rawSvg = resolveModelSwatch({ name: "Grok 4", icon: "<SVG viewBox='0 0 10 10'></SVG>" });
  assert.equal(rawSvg.glyph, "");
  assert.match(rawSvg.style.background, /\/model-icons\/grok\.png/);
});

test("reported brand assets exist", () => {
  for (const icon of ["bytedance.png", "grok.png"]) {
    assert.ok(statSync(new URL(`../../../../public/model-icons/${icon}`, import.meta.url)).size > 0);
  }
});

test("project launcher uses the same brand-aware model picker", () => {
  assert.match(quickStart, /import \{ ModelPicker \} from "\.\/nodes\/model-picker"/);
  assert.match(quickStart, /<ModelPicker[\s\S]*?models=\{selectableModels\}[\s\S]*?tone=\{isLauncher \? "dark" : "default"\}/);
});

test("every canvas model selector shares the brand-aware picker", () => {
  for (const [label, path, importPath] of canvasConsumers) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.ok(source.includes(`from "${importPath}"`), `${label} imports the shared picker`);
    assert.match(source, /<ModelPicker\b/, `${label} renders the shared picker`);
  }
});
