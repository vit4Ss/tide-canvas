import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const workbench = readFileSync(join(here, "analysis-workbench.tsx"), "utf8");
const api = readFileSync(join(here, "../../../lib/social-analysis-api.ts"), "utf8");
const rail = readFileSync(join(here, "../../../components/studio/studio-rail.tsx"), "utf8");

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
