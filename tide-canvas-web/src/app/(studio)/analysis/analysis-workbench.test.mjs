import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const workbench = readFileSync(join(here, "analysis-workbench.tsx"), "utf8");
const history = readFileSync(join(here, "activity-history.tsx"), "utf8");
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
  assert.match(workbench, /status\?\.imageAnalysisSkillId/);
  assert.match(workbench, /type: contentSkillMode/);
  assert.match(workbench, /role: contentSkillMode === "video" \? "source-video" : `source-image-/);
  assert.match(workbench, /analysisMode: skillMode/);
  assert.match(workbench, /storedMode === "account"/);
  assert.doesNotMatch(workbench, /accountRun =[^;]*prompt\.includes\("<platform_data"\)/);
  assert.match(api, /imageAnalysisSkillId\?: string/);
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

test("workbench keeps two action tabs with a11y wiring", () => {
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

test("selected-state rules outrank the base rules they must override", () => {
  // 真机截图暴露过一次:裸 `.modeActive` 只有 (0,1,0),被 `.modeSwitch button`
  // (0,1,1) 的 color 压过,选中的药丸变成浅底印 45% 白字,几乎看不见;页签的
  // 选中下划线同样静默失效。状态类必须写成复合选择器(基础选择器 + 状态类),
  // 否则加一条基础规则就会把状态样式悄悄压掉,而类型检查与 lint 都发现不了。
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const selectors = [...rules.matchAll(/([^{}]+)\{[^}]*\}/g)]
    .flatMap((match) => match[1].split(",").map((part) => part.trim()))
    // `:not(.xActive)` 是排除条件,不是状态规则。
    .filter((selector) => /Active/.test(selector.replace(/:not\([^)]*\)/g, "")));
  assert.ok(selectors.length >= 4, "expected the four selected-state rules");
  const bare = selectors.filter((selector) => {
    const compound = selector
      .replace(/:not\([^)]*\)/g, "")
      .split(/[\s>+~]+/)
      .filter(Boolean)
      .find((part) => /Active/.test(part)) ?? "";
    const stripped = compound.replace(/:[a-zA-Z-]+(\([^)]*\))?/g, "");
    // 合格写法:元素名 + 状态类(button.xActive),或两个类叠加。
    return !/^[a-z]+\./.test(stripped) && (stripped.match(/\./g) ?? []).length < 2;
  });
  assert.deepEqual(bare, [], `state classes need a compound selector: ${bare.join(", ")}`);
});

test("cross-tab bridge only appears for platforms the downloader actually serves", () => {
  // 拆解支持抖音/小红书,下载器支持 Pinterest/Instagram——两侧平台集合不同。
  // 不设闸的话,拆完抖音点「取原片」跳过去必然解析失败。
  assert.match(workbench, /canDownload=\{!!currentWork\.pageUrl && isVideoWork\(currentWork\) && downloaderPlatforms\.includes\(result\.platform\)\}/);
  assert.match(workbench, /isVideoWork\(inspectedWork\.work\) && downloaderPlatforms\.includes\(result\.platform\)/);
  assert.match(workbench, /下载原片/);
});

test("both tabs show a result-shaped skeleton while a request is in flight", () => {
  // 请求期间此前仍停在空态,页面看不出在做事。
  assert.match(workbench, /function ResultSkeleton/);
  assert.match(workbench, /\) : loading \? \(/);
  assert.match(workbench, /historicalRecord\?\.type === "download" \? null : downloadBusy \? \(/);
  // 拆解页用双栏骨架;下载页用封面形状的骨架,两者版式不同不强行复用。
  assert.match(workbench, /<ResultSkeleton \/>/);
  assert.match(workbench, /styles\.posterLoading/);
  assert.equal(workbench.match(/aria-busy="true"/g)?.length, 2);
  // 骨架是纯装饰,不该被读屏逐条念出来;进度由 role="status" 的一行文字承担。
  assert.match(workbench, /<div className=\{styles\.skeleton\} aria-hidden>/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.skeletonMedia,/);
});

test("both tabs explain a disabled service instead of only greying the button", () => {
  // 下载页早有说明,拆解页此前只置灰按钮,两侧对不齐。
  assert.match(workbench, /内容拆解服务当前已停用/);
  assert.match(workbench, /内容拆解服务尚未配置/);
  assert.match(workbench, /视频下载服务当前未启用/);
});

test("stylesheet stays inside the project design system", () => {
  // 上一版这里漂得很厉害:间距混用 5/6/7/9/11/13/15/18/22/26/30/38/42/46px,
  // 字号出现 11 种档位(含 9.5 / 11.5 / 12.5 / 13.5),都违反 AGENTS.md。
  // 这条测试把系统本身变成可执行约束,免得下一次改动又悄悄漂回去。
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");

  // 间距:4 的倍数;1-2px 只留给发丝级描边与内缩。
  const spacing = [...rules.matchAll(/(?:padding|margin|gap|row-gap|column-gap)[a-z-]*:\s*([^;]+);/g)]
    .flatMap((match) => [...match[1].matchAll(/(-?\d+(?:\.\d+)?)px/g)].map((value) => Math.abs(parseFloat(value[1]))));
  const offGrid = [...new Set(spacing.filter((value) => value > 2 && value % 4 !== 0))];
  assert.deepEqual(offGrid, [], `off-grid spacing: ${offGrid.join(", ")}px`);

  // 字阶:12(说明) / 14(正文) / 16(块级标题与数据值) / 20(区块标题与关键数值) /
  // 28(窄屏页标题与关键数字) / 32(页标题)。
  const scale = new Set([12, 14, 16, 20, 28, 32]);
  const sizes = [...new Set([...rules.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map((match) => parseFloat(match[1])))];
  const offScale = sizes.filter((value) => !scale.has(value));
  assert.deepEqual(offScale, [], `off-scale font sizes: ${offScale.join(", ")}px`);

  // 过渡时长只用 120 / 160 / 200ms;更长的是加载脉冲与 spinner,属功能性指示。
  const durations = [...new Set([...rules.matchAll(/transition:[^;]*?(\d+)ms/g)].map((match) => Number(match[1])))];
  const offTempo = durations.filter((value) => ![120, 160, 200].includes(value));
  assert.deepEqual(offTempo, [], `off-tempo transitions: ${offTempo.join(", ")}ms`);

  // 「减少 Card」按「一屏」计数,而不是按整张样式表:两个页签的面板从不同时出现,
  // 把它们加在一起会得出一个不存在的数字。虚线占位与加载骨架共用同一圆角但
  // 不是卡片,按语义排除。
  const raised = [...rules.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter(([, , body]) => /border-radius: var\(--r-lg\)/.test(body))
    .flatMap(([, selector, body]) => selector.split(",").map((part) => ({ selector: part.trim(), body })))
    .filter(({ selector, body }) => !/dashed/.test(body) && !/skeleton/i.test(selector))
    .map(({ selector }) => selector);
  const perTab = {
    breakdownContent: [".composer", ".contentHero", ".contentSignals", ".contentStrategy", ".runPanel"],
    breakdownAccount: [".composer", ".accountStrategy", ".runPanel"],
    download: [".getter", ".posterCard", ".formatCard", ".infoCard", ".historicalDownload", ".runPanel"],
  };
  const unaccounted = raised.filter((selector) => !Object.values(perTab).flat().includes(selector));
  assert.deepEqual(unaccounted, [], `raised surface not attributed to a tab: ${unaccounted.join(" | ")}`);
  for (const [tab, selectors] of Object.entries(perTab)) {
    const onScreen = selectors.filter((selector) => raised.includes(selector));
    // The account view is deliberately a dense intelligence board. Its four
    // major regions replace the old nested left/right cards, while the input
    // composer and a running report can coexist above/below them.
    const ceiling = tab === "breakdownAccount" || tab === "download" ? 6 : 5;
    assert.ok(onScreen.length <= ceiling, `too many card surfaces on ${tab}: ${onScreen.join(" | ")}`);
  }

  // 触屏目标:主题的 pointer:coarse 规则不覆盖 CSS Module,本页自己声明。
  assert.match(rules, /@media \(pointer: coarse\)/);
  assert.match(rules, /min-height: 44px/);

  // 张力路线的边界(用户 2026-09-04 定稿,见 AGENTS.md):彩色只能来自内容本身,
  // 因此品牌色一律经 --platform 注入,不在样式里写死任何品牌十六进制;
  // 玻璃层只允许压在真实图像上;渐变只用于表面材质,绝不用于文字。
  assert.doesNotMatch(rules, /#(?:00aeec|fe2c55|ff0033|e60023|e1306c|ff5000)/i);
  const glass = [...rules.matchAll(/([^{}]+)\{([^}]*backdrop-filter[^}]*)\}/g)].map((match) => match[1].trim());
  assert.deepEqual(glass, [".posterChip"], `glass may only sit on media overlays: ${glass.join(" | ")}`);
  assert.doesNotMatch(rules, /background-clip:\s*text|-webkit-background-clip:\s*text/);
});

test("left history sidebar restores an owned immutable snapshot without re-inspecting", () => {
  assert.match(api, /\/api\/social-analysis\/records/);
  assert.match(api, /\/api\/social-analysis\/records\/\$\{id\}/);
  assert.match(workbench, /<ActivityHistorySidebar/);
  assert.match(workbench, /refreshKey=\{historyRefresh\}/);
  assert.match(workbench, /watchId=\{watchedDownloadRecordId\}/);
  assert.match(history, /watched\.status === "succeeded"/);
  assert.match(workbench, /setHistoryRefresh\(\(value\) => value \+ 1\)/);
  assert.ok(workbench.indexOf("<ActivityHistorySidebar") < workbench.indexOf("styles.workspaceMain"));
  assert.match(workbench, /isSocialInspectSnapshot\(record\.snapshot\)/);
  assert.match(workbench, /skillRun\.resume\(record\.analysisRunId\)/);
  assert.match(workbench, /正在查看历史快照/);
  assert.match(workbench, /当时调用：/);
  assert.match(workbench, /获取最新数据/);
  assert.match(history, /socialAnalysisApi\.records/);
  assert.match(history, /socialAnalysisApi\.record\(record\.id\)/);
  assert.match(history, /仅当前账号可见/);
  assert.doesNotMatch(history, /userId:|userKeyword:/);
});

test("platform image hosts are hotlink-protected, so every cover omits the referrer", () => {
  // 实测 i0.hdslb.com:不带 Referer → HTTP 200,带跨站 Referer → HTTP 403。
  // 浏览器默认会带上本站地址,不显式声明的话封面/头像一律加载失败——这一页
  // 三处 <img> 都吃过这个亏,新增图片务必一并声明。
  const images = workbench.match(/<img[^>]*>/g) ?? [];
  assert.equal(images.length, 3, "the page has exactly three platform-hosted images");
  assert.ok(images.length >= 3, `expected the cover/avatar/poster images, saw ${images.length}`);
  for (const tag of images) {
    assert.match(tag, /referrerPolicy="no-referrer"/, `image sends a referrer: ${tag.slice(0, 80)}`);
    assert.match(tag, /onError=/, `image has no fallback: ${tag.slice(0, 80)}`);
  }
});

test("switching quality updates in place and blocks the stale download", () => {
  // 此前切换画质会先清空结果,整个结果区卸载再挂载,视觉上「刷一下」。
  assert.match(workbench, /const replaceInPlace = qualityOverride !== undefined && !!downloadResult;/);
  assert.match(workbench, /if \(!replaceInPlace\) setDownloadResult\(null\);/);
  // 原地更新期间旧的下载地址仍在屏幕上,必须禁用下载,否则拿到的是上一档画质。
  const formatCard = workbench.slice(workbench.indexOf("styles.formatCard"), workbench.indexOf("styles.formatSwitch"));
  assert.match(formatCard, /disabled=\{downloadBusy\}/);
  assert.match(formatCard, /data-busy=\{downloadBusy \? "true" : "false"\}/);
  assert.match(css, /\.formatCard\[data-busy="true"\] \.formatSpec/);
  // 选中态必须取自实际解析结果:downloadQuality 在解析前就变了,换档失败时
  // (结果原地保留)会出现「开关显示高清、卡片显示兼容」的自相矛盾。
  assert.match(workbench, /aria-pressed=\{downloadResult\.quality === option\.key\}/);
  assert.doesNotMatch(workbench, /aria-pressed=\{downloadQuality === option\.key\}/);
});

test("copyable metadata fields carry an accessible name", () => {
  // <span>标题</span> 不是 label,少了 aria-label 读屏只会念出一个无名输入框。
  assert.match(workbench, /<input readOnly value=\{value\} aria-label=\{label\}/);
  assert.match(workbench, /aria-label=\{`复制\$\{label\}`\}/);
});

test("account mode renders a real intelligence board instead of a source-and-text split", () => {
  assert.match(workbench, /function AccountDashboard/);
  assert.match(workbench, /result\.kind === "account"[\s\S]*<AccountDashboard/);
  for (const section of ["近期作品表现", "近期作品", "互动构成", "AI 账号策略拆解"]) {
    assert.ok(workbench.includes(section), `account board misses ${section}`);
  }
  assert.match(workbench, /buildAccountSnapshot\(result\)/);
  assert.match(workbench, /<table>[\s\S]*相对表现[\s\S]*<AccountWorkInspector/);
  assert.doesNotMatch(workbench, /聚焦样本|performanceBar/);
  assert.match(workbench, /这是当前抓取样本的横截面，不代表粉丝增长趋势或行业基准/);
  assert.match(css, /\.accountDashboard \{[\s\S]*container-type: inline-size/);
  assert.match(css, /@container \(max-width: 820px\)/);
  // The only valid trend is the dated work-sample series. It must not be
  // mislabeled as account growth or compared with a nonexistent benchmark.
  assert.doesNotMatch(workbench, /粉丝增长曲线|近30天增长|行业平均|同比|环比/);
  const accountHeroRule = css.slice(css.indexOf(".accountHero {"), css.indexOf(".accountIdentity {"));
  assert.doesNotMatch(accountHeroRule, /::before|background: var\(--platform\)/, "account header regained a decorative accent stripe");
});

test("account inspection automatically starts one strategy run without a second click", () => {
  assert.match(workbench, /pendingAccountAutoRunRef\.current = response\.data/);
  assert.match(workbench, /pendingAccountAutoRunRef\.current !== result/);
  assert.match(workbench, /pendingAccountAutoRunRef\.current = null;[\s\S]*queueMicrotask\(\(\) => \{ void startDeepAnalysis\(\); \}\)/);
  assert.match(workbench, /正在自动生成账号策略/);
  assert.match(workbench, /无需再次点击，结果会直接显示在右侧/);
  assert.match(workbench, /activityRecordId: result\.recordId/);
  assert.doesNotMatch(workbench, /busy \? "正在启动分析" : "生成账号策略"/);
});

test("single-work mode has a factual dashboard and a dedicated timecode report workspace", () => {
  assert.match(workbench, /function ContentDashboard/);
  assert.match(workbench, /result=\{result\}[\s\S]*work=\{currentWork\}[\s\S]*canDownload=/);
  for (const section of ["互动结构", "作品数据口径", "AI 视频深度拆解", "时间码报告将在这里展开"]) {
    assert.ok(workbench.includes(section), `work dashboard misses ${section}`);
  }
  assert.match(workbench, /buildWorkSnapshot\(work\)/);
  assert.match(workbench, /缺失字段不会按 0 处理/);
  assert.match(workbench, /function workImageSources/);
  assert.match(workbench, /contentImageURLs/);
  assert.match(workbench, /开始图文拆解/);
  assert.match(workbench, /source-image-/);
  assert.match(css, /\.contentDashboard \{[\s\S]*container-type: inline-size/);
});

test("a restored AI report is shown only beside the account or work that created it", () => {
  assert.match(workbench, /function analysisRunContext/);
  assert.match(workbench, /sourceUrl: sourceURL,[\s\S]{0,160}sourceFetchedAt: result\.fetchedAt/);
  assert.match(workbench, /activeRunContext\.sourceUrl === currentAnalysisSource/);
  assert.match(workbench, /activeRunContext\.sourceFetchedAt === result\.fetchedAt/);
  assert.match(workbench, /const contextualRunDetails = runMatchesCurrentResult \? runDetails : null/);
  assert.match(workbench, /runDetails=\{contextualRunDetails\}/);
  assert.match(workbench, /\{contextualRunDetails\}/);
  // A failed create has no run to carry source metadata. Starting another
  // inspection clears that orphaned error so it cannot leak to the new account.
  assert.match(workbench, /if \(!skillRun\.run && skillRun\.error\) skillRun\.clear\(\)/);
});
