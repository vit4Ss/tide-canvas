"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowUpRight,
  BarChart3,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  Eye,
  Film,
  Heart,
  Library,
  Link2,
  Loader2,
  MessageCircle,
  ScanSearch,
  Share2,
  Sparkles,
  UserRoundSearch,
  UsersRound,
} from "lucide-react";
import { fileApi } from "@/lib/api";
import { skillApi } from "@/lib/skill-api";
import {
  socialAnalysisApi,
  type SocialAnalysisKind,
  type SocialAnalysisStatusVO,
  type SocialInspectVO,
  type SocialPlatform,
  type SocialWorkVO,
} from "@/lib/social-analysis-api";
import { useAuth } from "@/hooks/use-auth";
import { useAuthStore } from "@/stores/use-auth-store";
import { useSkillRun } from "@/components/skill/use-skill-run";
import { SkillRunPanel, type SkillRunPanelActionPayload } from "@/components/skill/skill-run-panel";
import type { SkillRunAction } from "@/types/skill-run";
import { FileCategory } from "@/types/file";
import type { SkillVO } from "@/types/skill";
import styles from "./analysis.module.css";

const PLATFORMS: Array<{ key: SocialPlatform; label: string; mark: string; color: string; hint: string }> = [
  { key: "douyin", label: "抖音", mark: "抖", color: "#25f4ee", hint: "视频 · 账号" },
  { key: "bilibili", label: "哔哩哔哩", mark: "B", color: "#00aeec", hint: "视频 · UP主" },
  { key: "xiaohongshu", label: "小红书", mark: "小", color: "#ff2442", hint: "视频 · 图文" },
  { key: "youtube", label: "YouTube", mark: "▶", color: "#ff0033", hint: "视频 · 频道" },
  { key: "tiktok", label: "TikTok", mark: "♪", color: "#fe2c55", hint: "视频 · 账号" },
  { key: "kuaishou", label: "快手", mark: "快", color: "#ff5000", hint: "视频 · 账号" },
];

const DEFAULT_FOCUS = "完整转写视频文案，并拆解开头 3 秒钩子、叙事结构、镜头节奏、情绪变化、核心爆点和可复用的创作方法。所有判断请附时间码证据。";
const ACCOUNT_DEFAULT_FOCUS = "分析账号定位、目标受众、内容支柱和近期作品表现差异，提炼可复用的标题与开场模式，并给出未来两周可执行的选题矩阵和测试建议。";

function displayCount(value?: string): string {
  if (!value) return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return value;
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(number);
}

function displayDate(value?: string): string {
  if (!value) return "";
  const numeric = Number(value);
  let date: Date | null = null;
  if (Number.isFinite(numeric) && numeric > 0) {
    date = new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric);
  } else if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
    date = new Date(value);
  }
  return date && !Number.isNaN(date.valueOf())
    ? new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric" }).format(date)
    : value;
}

function titleOf(work: SocialWorkVO): string {
  return work.title?.trim() || work.description?.trim() || "未命名作品";
}

function safeFileName(title: string, mediaUrl: string): string {
  const cleaned = title.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 64);
  let extension = ".mp4";
  try {
    const match = /\.(mp4|webm|mov|mkv)$/i.exec(new URL(mediaUrl).pathname);
    if (match) extension = `.${match[1].toLowerCase()}`;
  } catch {
    // The server validates the URL; a malformed display value keeps the safe MP4 fallback.
  }
  return `${cleaned || "平台视频"}${extension}`;
}

function byteLength(value: string): number {
  return typeof TextEncoder !== "undefined" ? new TextEncoder().encode(value).length : value.length * 3;
}

function accountPrompt(result: SocialInspectVO, focus: string): string {
  const profile = result.profile ? {
    id: result.profile.id,
    name: result.profile.name?.slice(0, 160),
    handle: result.profile.handle?.slice(0, 160),
    bio: result.profile.bio?.slice(0, 600),
    followers: result.profile.followers,
    following: result.profile.following,
    likes: result.profile.likes,
    works: result.profile.works,
  } : undefined;
  const recentWorks = result.works.map((work) => ({
    id: work.id,
    title: work.title?.slice(0, 120),
    description: work.description?.slice(0, 240),
    publishedAt: work.publishedAt,
    duration: work.duration,
    mediaType: work.mediaType,
    stats: work.stats,
  }));
  const render = () => [
    "<user_request>",
    focus.trim() || ACCOUNT_DEFAULT_FOCUS,
    "</user_request>",
    "<platform_data untrusted=\"true\">",
    JSON.stringify({ platform: result.platformName, sourceUrl: result.sourceUrl, profile, recentWorks }),
    "</platform_data>",
  ].join("\n");
  let prompt = render();
  // Skill-run requests cap prompt bytes at 32 KiB. Drop the oldest tail
  // samples before the request can be rejected; the visible result remains intact.
  while (byteLength(prompt) > 30 * 1024 && recentWorks.length > 1) {
    recentWorks.pop();
    prompt = render();
  }
  return prompt;
}

function platformMeta(key?: SocialPlatform) {
  return PLATFORMS.find((item) => item.key === key) ?? PLATFORMS[0];
}

function PlatformMark({ platform, small = false }: { platform: SocialPlatform; small?: boolean }) {
  const meta = platformMeta(platform);
  return (
    <span aria-hidden="true" className={`${styles.platformMark}${small ? ` ${styles.platformMarkSmall}` : ""}`} style={{ "--platform": meta.color } as React.CSSProperties}>
      {meta.mark}
    </span>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value?: string }) {
  return (
    <div className={styles.metric}>
      <span>{icon}</span>
      <small>{label}</small>
      <strong>{displayCount(value)}</strong>
    </div>
  );
}

function WorkCover({ work, platform }: { work: SocialWorkVO; platform: SocialPlatform }) {
  const [failedUrl, setFailedUrl] = useState("");
  if (work.coverUrl && failedUrl !== work.coverUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className={styles.workCoverImage} src={work.coverUrl} alt="" loading="lazy" onError={() => setFailedUrl(work.coverUrl || "")} />;
  }
  return (
    <span className={styles.workCoverFallback}>
      <PlatformMark platform={platform} />
      <Film aria-hidden />
    </span>
  );
}

function ProfileAvatar({ url, platform }: { url?: string; platform: SocialPlatform }) {
  const [failedUrl, setFailedUrl] = useState("");
  if (!url || failedUrl === url) return <PlatformMark platform={platform} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" onError={() => setFailedUrl(url)} />;
}

function renderAnalysisMarkdown(text: string) {
  return (
    <div className={styles.markdown}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
          img: () => null,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

export default function AnalysisWorkbench() {
  const { user, initialized } = useAuth();
  const ensureSession = useAuthStore((state) => state.ensureSession);
  const [kind, setKind] = useState<SocialAnalysisKind>("content");
  const [url, setURL] = useState("");
  const [focus, setFocus] = useState(DEFAULT_FOCUS);
  const [status, setStatus] = useState<SocialAnalysisStatusVO | null>(null);
  const [statusRefresh, setStatusRefresh] = useState(0);
  const [statusChecking, setStatusChecking] = useState(false);
  const [statusError, setStatusError] = useState(false);
  const [result, setResult] = useState<SocialInspectVO | null>(null);
  const [selectedWork, setSelectedWork] = useState<SocialWorkVO | null>(null);
  const [loading, setLoading] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [error, setError] = useState("");
  const videoSkillRef = useRef<SkillVO | null>(null);
  const accountSkillRef = useRef<SkillVO | null>(null);
  const inspectBusyRef = useRef(false);
  const analysisBusyRef = useRef(false);
  const inspectEpochRef = useRef(0);
  const analysisEpochRef = useRef(0);
  const ownerUserId = user?.id ?? "";
  const previousOwnerRef = useRef(ownerUserId);
  const skillRun = useSkillRun({
    storageKey: "tidecanvas.social-analysis.active-run",
    ownerUserId,
    retainTerminalPointer: true,
  });

  useEffect(() => {
    if (previousOwnerRef.current === ownerUserId) return;
    previousOwnerRef.current = ownerUserId;
    inspectEpochRef.current += 1;
    analysisEpochRef.current += 1;
    inspectBusyRef.current = false;
    analysisBusyRef.current = false;
    setLoading(false);
    setArchiving(false);
    setStatus(null);
    setStatusChecking(false);
    setStatusError(false);
    setResult(null);
    setSelectedWork(null);
    setError("");
    skillRun.clear();
    // skillRun controller identity changes with polling state; only the owner
    // boundary should trigger this cleanup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerUserId, statusRefresh]);

  useEffect(() => {
    if (!ownerUserId) return;
    let cancelled = false;
    void Promise.resolve().then(async () => {
      if (cancelled) return;
      setStatusChecking(true);
      setStatusError(false);
      const response = await socialAnalysisApi.status();
      if (cancelled) return;
      if (response.success && response.data) setStatus(response.data);
      else {
        setStatusError(true);
        setError(response.message || "无法读取内容拆解服务状态");
      }
    }).finally(() => {
      if (!cancelled) setStatusChecking(false);
    });
    return () => { cancelled = true; };
  }, [ownerUserId]);

  const currentWork = selectedWork ?? result?.content ?? null;
  const currentPlatform = result?.platform;
  const metrics = currentWork?.stats ?? {};
  const statusLabel = initialized && !user
    ? "登录后检查服务"
    : statusChecking
      ? "正在检查服务"
      : statusError
        ? "检查失败，点击重试"
        : !status
          ? "等待检查服务"
    : !status.enabled
      ? "服务已停用"
      : status.configured
        ? "解析服务已配置"
        : "等待管理员配置";

  const inspect = async () => {
    if (inspectBusyRef.current || !url.trim()) return;
    inspectBusyRef.current = true;
    const epoch = ++inspectEpochRef.current;
    setLoading(true);
    setError("");
    setResult(null);
    setSelectedWork(null);
    try {
      if (!await ensureSession()) return;
      const response = await socialAnalysisApi.inspect({ url: url.trim(), kind });
      if (epoch !== inspectEpochRef.current) return;
      if (!response.success || !response.data) {
        setError(response.code === 429 ? "请求过于频繁，请稍后再试" : response.message || "链接解析失败，请检查后重试");
        return;
      }
      setResult(response.data);
      setSelectedWork(response.data.content ?? response.data.works[0] ?? null);
    } finally {
      if (epoch === inspectEpochRef.current) {
        inspectBusyRef.current = false;
        setLoading(false);
      }
    }
  };

  const loadAnalysisSkill = async (mode: SocialAnalysisKind): Promise<SkillVO | null> => {
    const cache = mode === "account" ? accountSkillRef : videoSkillRef;
    if (cache.current) return cache.current;
    const stableId = mode === "account" ? status?.accountAnalysisSkillId : status?.videoAnalysisSkillId;
    const title = mode === "account" ? "账号拆解" : "视频分析";
    if (stableId) {
      const exact = await skillApi.get(stableId, "studio");
      if (exact.success && exact.data) {
        cache.current = exact.data;
        return exact.data;
      }
    }
    const response = await skillApi.list({
      pageNum: 1,
      pageSize: 100,
      keyword: title,
      kind: "tool",
      entryPoint: "studio",
    });
    const skill = response.data?.records.find((item) => item.title === title) ?? null;
    if (skill) cache.current = skill;
    return skill;
  };

  const startDeepAnalysis = async () => {
    if (!result || !currentPlatform || analysisBusyRef.current || skillRun.loading) return;
    if (kind === "content" && !currentWork?.mediaUrl) return;
    analysisBusyRef.current = true;
    const epoch = ++analysisEpochRef.current;
    setArchiving(true);
    setError("");
    try {
      if (!await ensureSession()) return;
      const skill = await loadAnalysisSkill(kind);
      if (epoch !== analysisEpochRef.current) return;
      if (!skill) {
        setError(`${kind === "account" ? "账号拆解" : "视频分析"}技能未上架，请联系管理员检查技能配置`);
        return;
      }
      let assets: Array<{ id?: string; type: "video"; url?: string; name?: string; role?: string; metadata?: Record<string, unknown> }> = [];
      let prompt = "";
      const sourceURL = kind === "account"
        ? result.sourceUrl
        : currentWork?.pageUrl || result.sourceUrl || "";
      if (kind === "content" && currentWork?.mediaUrl) {
        const mediaCandidates = [...new Set([currentWork.mediaUrl, ...(currentWork.mediaUrls ?? [])].filter(Boolean))].slice(0, 5);
        let archived = null as Awaited<ReturnType<typeof fileApi.saveFromUrl>> | null;
        for (const candidate of mediaCandidates) {
          archived = await fileApi.saveFromUrl({
            url: candidate,
            fileType: "video",
            category: FileCategory.GENERAL,
            originalName: safeFileName(titleOf(currentWork), candidate),
          });
          if (epoch !== analysisEpochRef.current) return;
          if (archived.success && archived.data) break;
          if (archived.code !== 0 && archived.code !== 400 && archived.code !== 408) break;
        }
        if (!archived?.success || !archived.data) {
          setError(`视频归档失败：${archived?.message || "暂时无法读取视频"}。已尝试可用镜像；如果页面已打开较久，请重新解析作品以刷新临时地址。`);
          return;
        }
        assets = [{
          id: archived.data.id,
          type: "video",
          url: archived.data.fileUrl,
          name: archived.data.originalName,
          role: "source-video",
          metadata: { platform: currentPlatform, sourceUrl: sourceURL },
        }];
        prompt = [
          focus.trim() || DEFAULT_FOCUS,
          `平台：${result.platformName}`,
          `作品：${titleOf(currentWork)}`,
          sourceURL ? `来源：${sourceURL}` : "",
        ].filter(Boolean).join("\n");
      } else {
        prompt = accountPrompt(result, focus);
      }
      const started = await skillRun.start({
        skillId: skill.id,
        entryPoint: "studio",
        input: {
          prompt,
          assets,
          sourceNodeIds: [],
          parameters: { platform: currentPlatform, sourceUrl: sourceURL },
        },
      });
      if (epoch !== analysisEpochRef.current) return;
      if (!started) {
        setError(skillRun.error || `${kind === "account" ? "账号拆解" : "视频分析"}技能启动失败，请稍后重试`);
        return;
      }
      void skillApi.recordUse(skill.id);
    } finally {
      if (epoch === analysisEpochRef.current) {
        analysisBusyRef.current = false;
        setArchiving(false);
      }
    }
  };

  const performRunAction = async (action: SkillRunAction, payload?: SkillRunPanelActionPayload) => {
    const updated = await skillRun.performAction(action, {
      ...(payload?.feedback ? { feedback: payload.feedback } : {}),
      ...(payload?.input ? { input: payload.input } : {}),
    });
    if (!updated) setError(skillRun.error || "操作失败，请稍后重试");
  };

  const reEditRun = () => {
    const input = skillRun.run?.input;
    if (input && typeof input === "object" && !Array.isArray(input)) {
      const stored = input as { prompt?: unknown; parameters?: unknown };
      const prompt = typeof stored.prompt === "string" ? stored.prompt : "";
      const parameters = stored.parameters && typeof stored.parameters === "object" && !Array.isArray(stored.parameters)
        ? stored.parameters as Record<string, unknown>
        : {};
      const sourceUrl = typeof parameters.sourceUrl === "string" ? parameters.sourceUrl.trim() : "";
      const accountRun = skillRun.run?.skillId === status?.accountAnalysisSkillId || prompt.includes("<platform_data");
      if (sourceUrl) setURL(sourceUrl);
      setKind(accountRun ? "account" : "content");
      if (accountRun) {
        const match = /<user_request>\s*([\s\S]*?)\s*<\/user_request>/.exec(prompt);
        setFocus(match?.[1]?.trim() || ACCOUNT_DEFAULT_FOCUS);
      } else {
        setFocus(prompt.split("\n平台：", 1)[0]?.trim() || DEFAULT_FOCUS);
      }
    }
    setError("");
    setResult(null);
    setSelectedWork(null);
    skillRun.clear();
  };

  const capabilityItems = useMemo(() => kind === "content"
    ? [
        ["01", "文案转写", "ASR 与时间码定位"],
        ["02", "分镜拆解", "构图、景别与节奏"],
        ["03", "爆点诊断", "钩子、情绪和转化"],
      ]
    : [
        ["01", "账号画像", "定位、体量与内容方向"],
        ["02", "作品矩阵", "近期内容与互动表现"],
        ["03", "策略诊断", "模式提炼与选题建议"],
      ], [kind]);

  const runDetails = skillRun.run ? (
    <div className={styles.runPanel}>
      <SkillRunPanel
        run={skillRun.run}
        onAction={performRunAction}
        actionBusy={skillRun.actionBusy}
        inputSelectTone="dark"
        textRenderer={renderAnalysisMarkdown}
        onReEdit={reEditRun}
        onDismiss={() => skillRun.clear()}
      />
    </div>
  ) : null;

  return (
    <main className={styles.page}>
      <div className={styles.canvas}>
        <header className={styles.pageHeader}>
          <div>
            <span className={styles.eyebrow}>CONTENT INTELLIGENCE / 01</span>
            <h1>内容拆解</h1>
          </div>
          <div className={styles.headerCopy}>
            <p>从公开链接提取真实作品与账号信息，再用 AI 完成内容、分镜、爆点和账号策略分析。</p>
            <button
              type="button"
              className={styles.serviceState}
              data-ready={status?.enabled && status?.configured ? "true" : "false"}
              disabled={!user || statusChecking}
              title={user ? "重新检查解析服务" : "登录后检查解析服务"}
              aria-live="polite"
              onClick={() => {
                setStatus(null);
                setStatusError(false);
                setError("");
                setStatusRefresh((value) => value + 1);
              }}
            >
              <i /> {statusLabel}
            </button>
          </div>
        </header>

        <section className={styles.launchGrid}>
          <article className={styles.briefCard}>
            <div className={styles.briefIndex}>FL / BREAKDOWN</div>
            <div className={styles.briefBody}>
              <ScanSearch aria-hidden />
              <h2>把“感觉不错”<br />变成可复用的方法</h2>
              <p>链接负责还原事实，AI 负责解释为什么有效。结论、证据和时间码放在同一份拆解里。</p>
            </div>
            <div className={styles.capabilityList}>
              {capabilityItems.map(([index, label, detail]) => (
                <div key={index}><b>{index}</b><span><strong>{label}</strong><small>{detail}</small></span></div>
              ))}
            </div>
          </article>

          <article className={styles.inputCard}>
            <div className={styles.modeSwitch} aria-label="拆解模式">
              <button type="button" aria-pressed={kind === "content"} disabled={loading || archiving} className={kind === "content" ? styles.modeActive : ""} onClick={() => { setKind("content"); setFocus(DEFAULT_FOCUS); setResult(null); setSelectedWork(null); setError(""); }}>
                <Film aria-hidden /> 单作品拆解
              </button>
              <button type="button" aria-pressed={kind === "account"} disabled={loading || archiving} className={kind === "account" ? styles.modeActive : ""} onClick={() => { setKind("account"); setFocus(ACCOUNT_DEFAULT_FOCUS); setResult(null); setSelectedWork(null); setError(""); }}>
                <UserRoundSearch aria-hidden /> 账号拆解
              </button>
            </div>
            <label className={styles.urlField}>
              <span>{kind === "content" ? "作品链接" : "账号主页链接"}</span>
              <div>
                <Link2 aria-hidden />
                <input
                  value={url}
                  onChange={(event) => setURL(event.target.value)}
                  onKeyDown={(event) => { if (event.key === "Enter") void inspect(); }}
                  disabled={loading || archiving}
                  placeholder={kind === "content" ? "粘贴公开视频链接，自动识别平台" : "粘贴账号主页链接，读取账号与近期作品"}
                  maxLength={4096}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            </label>
            <div className={styles.inputFooter}>
              <span><Check aria-hidden /> 仅支持公开内容</span>
              {initialized && !user ? (
                <Link className={styles.primaryButton} href="/login">登录后使用 <ChevronRight aria-hidden /></Link>
              ) : (
                <button
                  className={styles.primaryButton}
                  type="button"
                  disabled={!url.trim() || loading || archiving || skillRun.loading || !status?.enabled || !status?.configured}
                  onClick={() => void inspect()}
                >
                  {loading ? <Loader2 className={styles.spin} aria-hidden /> : <Sparkles aria-hidden />}
                  {loading ? "正在读取平台数据" : "开始拆解"}
                </button>
              )}
            </div>
            {error && (
              <div className={styles.error} role="alert"><CircleAlert aria-hidden /><span>{error}</span></div>
            )}
          </article>
        </section>

        <section className={styles.platformRail} aria-label="支持的平台">
          <span className={styles.platformRailLabel}>首批支持</span>
          {PLATFORMS.map((item) => (
            <div key={item.key} className={styles.platformItem}>
              <PlatformMark platform={item.key} small />
              <span><b>{item.label}</b><small>{item.hint}</small></span>
            </div>
          ))}
        </section>

        {result ? (
          <section className={styles.resultSection}>
            <header className={styles.sectionHeader}>
              <div><span>ANALYSIS SOURCE</span><h2>{result.kind === "account" ? "账号与作品样本" : "作品事实卡"}</h2></div>
              <a href={result.sourceUrl} target="_blank" rel="noopener noreferrer">查看原链接 <ArrowUpRight aria-hidden /></a>
            </header>

            {!!result.warnings?.length && (
              <div className={styles.warningList} role="status">
                {result.warnings.map((warning) => (
                  <div className={styles.notice} key={warning}><CircleAlert aria-hidden /> {warning}</div>
                ))}
              </div>
            )}

            {result.profile && (
              <article className={styles.profileCard}>
                <div className={styles.profileIdentity}>
                  <ProfileAvatar url={result.profile.avatarUrl} platform={result.platform} />
                  <div><span>{result.platformName}</span><h3>{result.profile.name || result.profile.handle || "未命名账号"}</h3><p>{result.profile.bio || "平台暂未返回账号简介"}</p></div>
                </div>
                <div className={styles.profileNumbers}>
                  <div><small>粉丝</small><strong>{displayCount(result.profile.followers)}</strong></div>
                  <div><small>关注</small><strong>{displayCount(result.profile.following)}</strong></div>
                  <div><small>获赞</small><strong>{displayCount(result.profile.likes)}</strong></div>
                  <div><small>作品</small><strong>{displayCount(result.profile.works)}</strong></div>
                </div>
              </article>
            )}

            <div className={styles.resultGrid}>
              <div className={styles.sourceColumn}>
                {currentWork ? (
                  <article className={styles.selectedWork}>
                    <div className={styles.selectedMedia}>
                      <WorkCover work={currentWork} platform={result.platform} />
                      <span className={styles.sourceBadge}><PlatformMark platform={result.platform} small /> {result.platformName}</span>
                      {currentWork.duration && <span className={styles.duration}><Clock3 aria-hidden /> {currentWork.duration}</span>}
                    </div>
                    <div className={styles.selectedBody}>
                      <span className={styles.selectedKicker}>{result.kind === "account" ? "SELECTED SAMPLE" : "SOURCE CONTENT"}</span>
                      <h3>{titleOf(currentWork)}</h3>
                      {currentWork.description && currentWork.description !== currentWork.title && <p>{currentWork.description}</p>}
                      {currentWork.publishedAt && <time>{displayDate(currentWork.publishedAt)}</time>}
                    </div>
                    <div className={styles.metrics}>
                      <Metric icon={<Eye aria-hidden />} label="播放" value={metrics.play} />
                      <Metric icon={<Heart aria-hidden />} label="点赞" value={metrics.like} />
                      <Metric icon={<MessageCircle aria-hidden />} label="评论" value={metrics.comment} />
                      <Metric icon={<Share2 aria-hidden />} label="分享" value={metrics.share} />
                    </div>
                  </article>
                ) : (
                  <div className={styles.emptyResult}><Film aria-hidden /><p>平台返回了账号信息，但暂时没有可展示的公开作品。</p></div>
                )}

                {result.works.length > 0 && (
                  <div className={styles.workList}>
                    <div className={styles.workListHead}><span>近期作品</span><small>{result.works.length} 个样本</small></div>
                    {result.works.map((work, index) => (
                      <button
                        type="button"
                        key={work.id || `${work.pageUrl}-${index}`}
                        className={currentWork === work ? styles.workRowActive : ""}
                        aria-pressed={currentWork === work}
                        disabled={archiving || skillRun.loading}
                        onClick={() => setSelectedWork(work)}
                      >
                        <span className={styles.workThumb}><WorkCover work={work} platform={result.platform} /></span>
                        <span className={styles.workInfo}><b>{titleOf(work)}</b><small>{displayCount(work.stats.play)} 播放 · {displayCount(work.stats.like)} 点赞</small></span>
                        <ChevronRight aria-hidden />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className={styles.analysisColumn}>
                <article className={styles.aiCard}>
                  <div className={styles.aiCardHead}>
                    <span><Sparkles aria-hidden /></span>
                    <div><small>FLOWINGLIGHT AI</small><h3>{kind === "account" ? "AI 账号策略拆解" : "视频深度拆解"}</h3></div>
                  </div>
                  <p>{kind === "account"
                    ? "基于账号资料与近期作品样本，分析定位、内容支柱和表现差异，并给出可执行的选题与测试建议。"
                    : "视频会先安全归档到你的资产库，再交给视频分析技能提取音轨与关键帧。页面关闭后任务仍可恢复。"}</p>
                  <label className={styles.focusField}>
                    <span>你希望重点分析什么</span>
                    <textarea rows={5} value={focus} onChange={(event) => setFocus(event.target.value)} maxLength={4000} />
                    <small>{focus.length} / 4000</small>
                  </label>
                  <div className={styles.aiActionRow}>
                    <span><Library aria-hidden /> {kind === "account" ? "仅使用当前公开样本" : "分析素材自动进入资产库"}</span>
                    <button
                      type="button"
                      disabled={(kind === "content" ? !currentWork?.mediaUrl : !result.profile && result.works.length === 0) || archiving || skillRun.loading || !!skillRun.run}
                      onClick={() => void startDeepAnalysis()}
                    >
                      {archiving || skillRun.loading ? <Loader2 className={styles.spin} aria-hidden /> : <ScanSearch aria-hidden />}
                      {archiving
                        ? kind === "account" ? "正在启动分析" : "正在归档视频"
                        : skillRun.loading ? "正在启动技能"
                          : kind === "account" ? "生成账号拆解" : "AI 深度拆解"}
                    </button>
                  </div>
                  {kind === "content" && !currentWork?.mediaUrl && currentWork && (
                    <div className={styles.notice}><CircleAlert aria-hidden /> 当前平台只返回了作品信息，没有可归档的视频直链；可先查看数据，或换一个公开视频链接。</div>
                  )}
                </article>

                {skillRun.error && <div className={styles.error} role="alert"><CircleAlert aria-hidden /><span>{skillRun.error}</span></div>}
                {runDetails}
              </div>
            </div>
          </section>
        ) : (
          <section className={styles.emptyBento}>
            <article><BarChart3 aria-hidden /><span>事实层</span><h3>先拿到平台原始数据</h3><p>标题、作者、发布时间与互动指标来自对应平台解析结果，不让 AI 猜数字。</p></article>
            <article><Film aria-hidden /><span>内容层</span><h3>文案和画面一起看</h3><p>抽取音轨与关键帧，按时间线拆解钩子、节奏、转场和信息密度。</p></article>
            <article><UsersRound aria-hidden /><span>账号层</span><h3>从单条回到账户策略</h3><p>读取近期作品矩阵，选代表样本继续深拆，逐步沉淀可复用的创作模式。</p></article>
          </section>
        )}
        {!result && runDetails && (
          <section className={styles.standaloneRun}>
            <header className={styles.sectionHeader}>
              <div><span>ACTIVE ANALYSIS</span><h2>{skillRun.run?.skillTitle || "拆解任务"}</h2></div>
            </header>
            {runDetails}
          </section>
        )}
      </div>
    </main>
  );
}
