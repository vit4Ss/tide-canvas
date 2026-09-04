import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const workbench = readFileSync(join(here, "analysis-workbench.tsx"), "utf8");
const api = readFileSync(join(here, "../../../lib/social-analysis-api.ts"), "utf8");
const rail = readFileSync(join(here, "../../../components/studio/studio-rail.tsx"), "utf8");
const css = readFileSync(join(here, "analysis.module.css"), "utf8");

test("analysis rail entry remains between Studio and 3D", () => {
  const studio = rail.indexOf('href: "/studio"');
  const analysis = rail.indexOf('href: "/analysis"');
  const threeD = rail.indexOf('href: "/three-d"');
  assert.ok(studio >= 0 && analysis > studio && threeD > analysis);
  assert.match(rail.slice(analysis, threeD), /key: "analysis"/);
});

test("analysis workbench keeps all six initial platforms and both modes", () => {
  for (const platform of ["douyin", "bilibili", "xiaohongshu", "youtube", "tiktok", "kuaishou"]) {
    assert.match(workbench, new RegExp(`key: "${platform}"`));
  }
  assert.match(workbench, /useState<SocialAnalysisKind>\("content"\)/);
  assert.match(workbench, /setKind\("account"\)/);
  assert.match(api, /kind: SocialAnalysisKind/);
});

test("paid analysis and TikHub parsing are synchronously fenced against duplicate clicks", () => {
  assert.match(workbench, /inspectBusyRef\.current/);
  assert.match(workbench, /analysisBusyRef\.current/);
  assert.match(workbench, /inspectEpochRef\.current/);
  assert.match(workbench, /analysisEpochRef\.current/);
  assert.match(workbench, /disabled=\{loading \|\| archiving\}/);
});

test("video archival retries bounded mirrors and stops on definitive failures", () => {
  assert.match(workbench, /currentWork\.mediaUrls/);
  assert.match(workbench, /\.slice\(0, 5\)/);
  assert.match(workbench, /archived\.code !== 0 && archived\.code !== 400 && archived\.code !== 408/);
  assert.match(workbench, /fileApi\.saveFromUrl/);
});

test("skill runs remain account-partitioned, restorable and re-editable", () => {
  assert.match(workbench, /storageKey: "tidecanvas\.social-analysis\.active-run"/);
  assert.match(workbench, /ownerUserId/);
  assert.match(workbench, /retainTerminalPointer: true/);
  assert.match(workbench, /setResult\(null\)[\s\S]*setSelectedWork\(null\)[\s\S]*skillRun\.clear\(\)/);
  assert.match(workbench, /kind === "account"[\s\S]*\? result\.sourceUrl/);
  assert.match(workbench, /textRenderer=\{renderAnalysisMarkdown\}/);
  assert.match(workbench, /img: \(\) => null/);
});

test("browser API exposes no TikHub credential field", () => {
  assert.match(api, /\/api\/social-analysis\/status/);
  assert.match(api, /\/api\/social-analysis\/inspect/);
  assert.doesNotMatch(api, /apiKey|accessToken|Authorization/);
});

test("public video downloader uses Relay capability discovery and a native hidden-frame download", () => {
  assert.match(api, /\/api\/social-analysis\/downloader\/platforms/);
  assert.match(api, /\/api\/social-analysis\/downloader\/resolve/);
  assert.match(workbench, /pinterest: "Pinterest"/);
  assert.match(workbench, /instagram: "Instagram"/);
  for (const quality of ["quality", "compat", "speed"]) {
    assert.match(workbench, new RegExp(`key: "${quality}"`));
  }
  assert.match(workbench, /function startNativeDownload/);
  assert.match(workbench, /document\.createElement\("iframe"\)/);
  assert.match(workbench, /frame\.src = apiUrl\(downloadUrl\)/);
  assert.doesNotMatch(workbench, /anchor\.rel = "noopener"/);
  assert.match(workbench, /已交给浏览器下载，请查看默认下载目录/);
  assert.match(workbench, /const downloaderPlatforms = downloaderCapabilities\?\.platforms \?\? \[\]/);
  assert.match(workbench, /下载票据有效/);
});

test("workbench splits into two top-level tabs with a11y wiring", () => {
  assert.match(workbench, /useState<WorkbenchTab>\("breakdown"\)/);
  assert.match(workbench, /role="tablist"/);
  for (const id of ["breakdown", "download"]) {
    assert.match(workbench, new RegExp(`id="analysis-tab-${id}"`));
    assert.match(workbench, new RegExp(`id="analysis-panel-${id}"`));
    assert.match(workbench, new RegExp(`aria-controls="analysis-panel-${id}"`));
    assert.match(workbench, new RegExp(`aria-labelledby="analysis-tab-${id}"`));
  }
  // Roving tabindex keeps the tablist a single stop for keyboard users, which
  // makes arrow-key movement mandatory: without it the unselected tab is
  // unreachable by keyboard entirely.
  assert.match(workbench, /tabIndex=\{tab === "breakdown" \? 0 : -1\}/);
  assert.match(workbench, /tabIndex=\{tab === "download" \? 0 : -1\}/);
  assert.match(workbench, /const onTabKeyDown =/);
  for (const key of ["ArrowRight", "ArrowLeft", "Home", "End"]) {
    assert.ok(workbench.includes(`"${key}"`), `tablist ignores ${key}`);
  }
  assert.equal(workbench.match(/onKeyDown=\{onTabKeyDown\}/g)?.length, 2);
});

test("service state is stated once and follows the active tab", () => {
  // Each tab is backed by a different service (TikHub parse / Relay downloader);
  // one control with a tab-aware value replaces the two duplicated indicators.
  assert.match(workbench, /const serviceReady = tab === "breakdown"/);
  assert.match(workbench, /const serviceLabel = tab === "breakdown" \? statusLabel : downloaderStateLabel/);
  assert.match(workbench, /const recheckService = \(\)/);
  assert.equal(workbench.match(/className=\{styles\.serviceState\}/g)?.length, 1);
});

test("analysis surface renders from imini theme tokens instead of its own hex palette", () => {
  const declared = css.match(/var\(--[a-z0-9-]+\)/g) ?? [];
  assert.ok(declared.length > 100, `expected token-driven styling, saw ${declared.length} references`);
  for (const token of ["var(--bg)", "var(--surface)", "var(--border)", "var(--text)", "var(--accent)"]) {
    assert.ok(css.includes(token), `missing ${token}`);
  }
  // Platform brand colour arrives through a custom property and the ready dot
  // uses the theme's cold-cyan accent, so the only literal hues left are the two
  // danger values declared once at the top of the file. Anything else is drift.
  // 注释里可以引用具体色值做论证,只有真正的声明算漂移。
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const hex = rules.match(/#[0-9a-fA-F]{3,8}/g) ?? [];
  assert.deepEqual(hex, ["#f87171", "#fca5a5"], `unexpected hardcoded colours: ${hex.join(", ")}`);
  assert.match(css, /--danger-line: #f87171;/);
  assert.doesNotMatch(rules, /rgba\(\s*\d/, "raw rgba() values bypass the theme tokens");
});

test("decorative eyebrows and the marketing brief card are gone", () => {
  for (const kicker of ["CONTENT INTELLIGENCE", "FL / BREAKDOWN", "PUBLIC VIDEO", "ANALYSIS SOURCE", "SELECTED SAMPLE", "SOURCE CONTENT", "FLOWINGLIGHT AI", "ACTIVE ANALYSIS"]) {
    assert.doesNotMatch(workbench, new RegExp(kicker));
  }
  assert.doesNotMatch(workbench, /briefCard|capabilityList|emptyBento|platformRail/);
});

test("weak text sitting on the page background clears the 4.5:1 floor", () => {
  // 主题的 --text-faint 是 45% 白:落在卡片底(#131316)上 4.51:1 达标,落在页面底
  // (#0A0A0B)与输入框底上只有 4.49:1。占位符同样受 PRODUCT.md 的 4.5 约束,
  // 因此这两处提到 48%(实测 4.68:1)。改动此值前请重算对比度。
  assert.match(css, /--text-quiet: color-mix\(in oklab, var\(--text\) 48%, transparent\);/);
  assert.match(css, /\.urlField input::placeholder \{ color: var\(--text-quiet\); \}/);
  const tabRule = css.slice(css.indexOf(".tabs button {"), css.indexOf(".tabs button:hover"));
  assert.match(tabRule, /color: var\(--text-quiet\)/);
});
