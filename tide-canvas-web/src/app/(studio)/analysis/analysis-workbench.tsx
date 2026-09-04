"use client";

/* /analysis — 拆解工作台。

   两件事共用一个入口:「内容拆解」把公开链接还原成平台事实再交给 AI 拆方法,
   「视频下载」把公开视频取回本地。两者都从一条链接出发、各自依赖不同的后端
   服务(TikHub 解析 / Relay 下载器),因此并列为顶层页签而不是上下堆叠——
   一次只做一件事,各自占满整幅宽度,状态词汇只写一遍。

   配色全部走 imini 主题 token(--bg/--surface/--border/--text/--accent),
   不再手抄十六进制:主题调整时本页跟随,不会落单。 */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  CalendarDays,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  Copy,
  Download,
  FileVideo,
  Film,
  Gauge,
  Link2,
  Loader2,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Target,
  Trophy,
  UserRoundSearch,
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
  type VideoDownloaderCapabilitiesVO,
  type VideoDownloadQuality,
  type VideoDownloadResolveVO,
} from "@/lib/social-analysis-api";
import { apiUrl } from "@/lib/http";
import { useAuth } from "@/hooks/use-auth";
import { useAuthStore } from "@/stores/use-auth-store";
import { useSkillRun } from "@/components/skill/use-skill-run";
import { SkillRunPanel, type SkillRunPanelActionPayload } from "@/components/skill/skill-run-panel";
import type { SkillRunAction } from "@/types/skill-run";
import { FileCategory } from "@/types/file";
import type { SkillVO } from "@/types/skill";
import { toast } from "@/components/shared/toast";
import { buildAccountSnapshot } from "./account-insights";
import { buildWorkSnapshot } from "./work-insights";
import styles from "./analysis.module.css";

type WorkbenchTab = "breakdown" | "download";

const PLATFORMS: Array<{ key: SocialPlatform; label: string; mark: string; color: string; hint: string }> = [
  { key: "douyin", label: "抖音", mark: "抖", color: "#25f4ee", hint: "视频 · 账号" },
  { key: "bilibili", label: "哔哩哔哩", mark: "B", color: "#00aeec", hint: "视频 · UP主" },
  { key: "xiaohongshu", label: "小红书", mark: "小", color: "#ff2442", hint: "视频 · 图文" },
  { key: "youtube", label: "YouTube", mark: "▶", color: "#ff0033", hint: "视频 · 频道" },
  { key: "tiktok", label: "TikTok", mark: "♪", color: "#fe2c55", hint: "视频 · 账号" },
  { key: "kuaishou", label: "快手", mark: "快", color: "#ff5000", hint: "视频 · 账号" },
];

const DEFAULT_FOCUS = "完整转写视频文案，并拆解开头 3 秒钩子、叙事结构、镜头节奏、情绪变化、核心爆点和可复用的创作方法。所有判断请附时间码证据。";
const IMAGE_DEFAULT_FOCUS = "分析画面主体、视觉层级、构图与视线动线、色彩光线、可读文案和传播钩子，提炼可复用的封面与图文创作方法，并明确区分可见事实和推断。";
const ACCOUNT_DEFAULT_FOCUS = "分析账号定位、目标受众、内容支柱和近期作品表现差异，提炼可复用的标题与开场模式，并给出未来两周可执行的选题矩阵和测试建议。";

const DOWNLOAD_QUALITY: Array<{ key: VideoDownloadQuality; label: string; detail: string }> = [
  { key: "compat", label: "兼容", detail: "最高 1080P · H.264 MP4" },
  { key: "quality", label: "高清", detail: "最高可用画质" },
  { key: "speed", label: "极速", detail: "最高 480P" },
];

/* 下载器支持的平台与拆解侧不完全重合(多了 Pinterest / Instagram),
   品牌色单独列一份:它是这张结果卡唯一的强调色来源。 */
const DOWNLOAD_PLATFORM_COLOR: Record<string, string> = {
  pinterest: "#e60023",
  bilibili: "#00aeec",
  kuaishou: "#ff5000",
  tiktok: "#fe2c55",
  instagram: "#e1306c",
  youtube: "#ff0033",
};

const DOWNLOAD_PLATFORM_LABEL: Record<string, string> = {
  pinterest: "Pinterest",
  bilibili: "哔哩哔哩",
  kuaishou: "快手",
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
};

function displayCount(value?: string): string {
  if (!value) return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return value;
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(number);
}

function displayCompactMetric(value: number | null, suffix = ""): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return `${new Intl.NumberFormat("zh-CN", {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: value >= 10_000 ? 1 : 0,
  }).format(value)}${suffix}`;
}

function displayPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const digits = value < 1 ? 2 : value < 10 ? 1 : 0;
  return `${value.toFixed(digits)}%`;
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

function displayBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "大小待下载时确认";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 100 || unit === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`;
}

function displayDurationSeconds(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "时长未知";
  const seconds = Math.round(value);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}` : `${minutes}:${String(rest).padStart(2, "0")}`;
}

function displayTokenTTL(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "以解析结果为准";
  if (seconds < 60) return `${Math.floor(seconds)} 秒`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return remainingSeconds ? `${minutes} 分 ${remainingSeconds} 秒` : `${minutes} 分钟`;
}

function extractDownloadURL(value: string): string {
  const match = value.trim().match(/https:\/\/[^\s<>"']+/i);
  return match?.[0]?.replace(/[.,;!?，。；！？、）)\]}》】]+$/, "") || "";
}

function startNativeDownload(downloadUrl: string) {
  const frame = document.createElement("iframe");
  frame.hidden = true;
  frame.referrerPolicy = "no-referrer";
  frame.src = apiUrl(downloadUrl);
  document.body.appendChild(frame);
  // Keep the navigation context alive for the server's full one-hour stream
  // window. Removing it after the short resolve-token TTL can cancel a slow,
  // already-authorized large-file download in some browsers.
  window.setTimeout(() => frame.remove(), 65 * 60 * 1_000);
}

function titleOf(work: SocialWorkVO): string {
  return work.title?.trim() || work.description?.trim() || "未命名作品";
}

function isVideoWork(work: SocialWorkVO): boolean {
  return work.mediaType?.toLowerCase().includes("video") === true || !!work.mediaUrl;
}

function workImageSources(work: SocialWorkVO): string[] {
  const images = [...new Set((work.imageUrls ?? []).map((value) => value.trim()).filter(Boolean))].slice(0, 9);
  if (images.length > 0) return images;
  return work.coverUrl?.trim() ? [work.coverUrl.trim()] : [];
}

function safeFileName(title: string, mediaUrl: string): string {
  const cleaned = title.replace(/[\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 64);
  let extension = ".mp4";
  try {
    const match = /\.(mp4|webm|mov|mkv)$/i.exec(new URL(mediaUrl).pathname);
    if (match) extension = `.${match[1].toLowerCase()}`;
  } catch {
    // The server validates the URL; a malformed display value keeps the safe MP4 fallback.
  }
  return `${cleaned || "平台视频"}${extension}`;
}

function safeImageFileName(title: string, imageUrl: string): string {
  const cleaned = title.replace(/[\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim().slice(0, 64);
  let extension = ".jpg";
  try {
    const match = /\.(jpe?g|png|webp|gif)$/i.exec(new URL(imageUrl).pathname);
    if (match) extension = `.${match[1].toLowerCase()}`;
  } catch {
    // saveFromUrl validates the URL; the display filename keeps a safe fallback.
  }
  return `${cleaned || "平台图片"}${extension}`;
}

function byteLength(value: string): number {
  return typeof TextEncoder !== "undefined" ? new TextEncoder().encode(value).length : value.length * 3;
}

function accountPrompt(result: SocialInspectVO, focus: string): string {
  const snapshot = buildAccountSnapshot(result);
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
  const sampleSummary = {
    sampleCount: snapshot.sampleCount,
    measuredViewSamples: snapshot.measuredViews,
    totalSampleViews: snapshot.totalViews,
    averageSampleViews: snapshot.averageViews,
    medianSampleViews: snapshot.medianViews,
    measuredInteractionSamples: snapshot.measuredInteractions,
    visibleInteractions: snapshot.measuredInteractions ? snapshot.totalInteractions : null,
    visibleEngagementRate: snapshot.engagementRate,
    averageViewsToFollowersRate: snapshot.viewToFollowerRate,
    topWorkViewConcentration: snapshot.topConcentration,
    timedSamples: snapshot.measuredPublished,
    samplePostsPerWeek: snapshot.postsPerWeek,
  };
  const render = () => [
    "<user_request>",
    focus.trim() || ACCOUNT_DEFAULT_FOCUS,
    "</user_request>",
    "<platform_data untrusted=\"true\">",
    JSON.stringify({ platform: result.platformName, sourceUrl: result.sourceUrl, profile, sampleSummary, recentWorks }),
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

function contentPrompt(result: SocialInspectVO, work: SocialWorkVO, focus: string, videoWork: boolean): string {
  return [
    "<user_request>",
    focus.trim() || (videoWork ? DEFAULT_FOCUS : IMAGE_DEFAULT_FOCUS),
    "</user_request>",
    "<platform_data untrusted=\"true\">",
    JSON.stringify({
      platform: result.platformName,
      sourceUrl: work.pageUrl || result.sourceUrl,
      title: work.title?.slice(0, 300),
      description: work.description?.slice(0, 1000),
      publishedAt: work.publishedAt,
      duration: work.duration,
      mediaType: work.mediaType,
      stats: work.stats,
    }),
    "</platform_data>",
  ].join("\n");
}

function analysisRunContext(input: unknown): { sourceUrl: string; sourceFetchedAt: number | null } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { sourceUrl: "", sourceFetchedAt: null };
  const parameters = (input as { parameters?: unknown }).parameters;
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) return { sourceUrl: "", sourceFetchedAt: null };
  const record = parameters as { sourceUrl?: unknown; sourceFetchedAt?: unknown };
  return {
    sourceUrl: typeof record.sourceUrl === "string" ? record.sourceUrl.trim() : "",
    sourceFetchedAt: typeof record.sourceFetchedAt === "number" && Number.isFinite(record.sourceFetchedAt)
      ? record.sourceFetchedAt
      : null,
  };
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

function WorkCover({ work, platform, alt = "" }: { work: SocialWorkVO; platform: SocialPlatform; alt?: string }) {
  const [failedUrl, setFailedUrl] = useState("");
  if (work.coverUrl && failedUrl !== work.coverUrl) {
    // 平台图床按 Referer 防盗链(实测 i0.hdslb.com:无 Referer 200 / 跨站 Referer 403),
    // 浏览器默认会带上本站地址,必须显式声明不发送,否则封面一律加载失败。
    // eslint-disable-next-line @next/next/no-img-element
    return <img className={styles.workCoverImage} src={work.coverUrl} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedUrl(work.coverUrl || "")} />;
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
  // 同 WorkCover:平台图床按 Referer 防盗链,不声明就取不到头像。
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" referrerPolicy="no-referrer" onError={() => setFailedUrl(url)} />;
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

/* 下载结果的封面主体。上游给了封面就用真图,没给就用平台品牌色铺一层色调场——
   比一块灰盒子诚实,也让这张卡有真正的主体。品牌色同时是这张卡唯一的强调色。 */
function DownloadPoster({ result }: { result: VideoDownloadResolveVO }) {
  const [failed, setFailed] = useState(false);
  const cover = failed ? "" : result.coverUrl?.trim() || "";
  const tint = DOWNLOAD_PLATFORM_COLOR[result.platform] || "#8b8b93";
  const platformLabel = DOWNLOAD_PLATFORM_LABEL[result.platform] || result.platform;
  const qualityLabel = DOWNLOAD_QUALITY.find((item) => item.key === result.quality)?.label || result.quality;
  return (
    <div className={styles.posterMedia} style={{ "--platform": tint } as React.CSSProperties}>
      {cover ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={cover} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      ) : (
        <span className={styles.posterFallback} aria-hidden><Film /></span>
      )}
      <span className={`${styles.posterChip} ${styles.posterChipPlatform}`}>{platformLabel}</span>
      <span className={`${styles.posterChip} ${styles.posterChipQuality}`}>{qualityLabel}</span>
      {result.durationSeconds > 0 && (
        <span className={`${styles.posterChip} ${styles.posterChipDuration}`}>
          <Clock3 aria-hidden />{displayDurationSeconds(result.durationSeconds)}
        </span>
      )}
    </div>
  );
}

/* 可复制的元信息行。下载站的常见做法:解析出来的标题与封面地址往往还要拿去
   别处用,做成只读字段 + 一键复制比让用户从卡片里手选文本可靠。 */
function InfoRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(value);
      setCopied(true);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("复制失败，可手动选中文本");
    }
  };
  return (
    <div className={styles.infoRow}>
      <span>{label}</span>
      <input readOnly value={value} aria-label={label} onFocus={(event) => event.currentTarget.select()} />
      <button type="button" onClick={() => void copy()} aria-label={`复制${label}`}>
        {copied ? <Check aria-hidden /> : <Copy aria-hidden />}{copied ? "已复制" : "复制"}
      </button>
    </div>
  );
}

/* 拆解结果版式的占位骨架:双栏轮廓与真实结果一致,返回时不跳版。
   下载页有自己的封面形状骨架,不复用这个。 */
function ResultSkeleton() {
  const bar = (width: string) => <span className={styles.skeletonBar} style={{ width }} />;
  return (
    <div className={styles.skeleton} aria-hidden>
      <div className={styles.skeletonGrid}>
        <div className={styles.skeletonCard}>
          <span className={styles.skeletonMedia} />
          {bar("72%")}
          {bar("46%")}
          <div className={styles.skeletonRow}>
            {bar("100%")}{bar("100%")}{bar("100%")}{bar("100%")}
          </div>
        </div>
        <div className={styles.skeletonCard}>
          {bar("40%")}{bar("88%")}{bar("64%")}{bar("76%")}
        </div>
      </div>
    </div>
  );
}

interface AccountDashboardProps {
  result: SocialInspectVO;
  currentWork: SocialWorkVO | null;
  focus: string;
  busy: boolean;
  runDetails: React.ReactNode;
  skillError: string;
  downloaderPlatforms: string[];
  onSelectWork: (work: SocialWorkVO) => void;
  onFocusChange: (value: string) => void;
  onRun: () => void;
  onDownloadWork: (work: SocialWorkVO) => void;
}

function AccountDashboard({
  result,
  currentWork,
  focus,
  busy,
  runDetails,
  skillError,
  downloaderPlatforms,
  onSelectWork,
  onFocusChange,
  onRun,
  onDownloadWork,
}: AccountDashboardProps) {
  const snapshot = buildAccountSnapshot(result);
  const meta = platformMeta(result.platform);
  const profile = result.profile;
  const currentDatum = snapshot.works.find((item) => item.work === currentWork) ?? snapshot.rankedWorks[0] ?? null;
  const chartWorks = snapshot.rankedWorks.slice(0, 8);
  const interactionTotal = snapshot.interactionParts.reduce((sum, item) => sum + item.value, 0);
  const publishedRange = snapshot.firstPublishedAt !== null && snapshot.lastPublishedAt !== null
    ? `${displayDate(String(snapshot.firstPublishedAt))} — ${displayDate(String(snapshot.lastPublishedAt))}`
    : "发布时间不完整";
  const fetchedLabel = result.fetchedAt > 0
    ? `抓取于 ${new Intl.DateTimeFormat("zh-CN", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(result.fetchedAt))}`
    : "本次查询";

  return (
    <div className={styles.accountDashboard} style={{ "--platform": meta.color } as React.CSSProperties}>
      <header className={styles.accountHero}>
        <div className={styles.accountIdentity}>
          <span className={styles.accountAvatar}><ProfileAvatar url={profile?.avatarUrl} platform={result.platform} /></span>
          <div className={styles.accountIdentityText}>
            <div className={styles.accountMetaLine}>
              <span><PlatformMark platform={result.platform} small />{result.platformName}</span>
              {profile?.handle && <code title={profile.handle}>{profile.handle}</code>}
            </div>
            <h2>{profile?.name || profile?.handle || "未命名账号"}</h2>
            <p title={profile?.bio}>{profile?.bio || "平台暂未返回账号简介"}</p>
          </div>
        </div>
        <div className={styles.accountHeroActions}>
          <span>{fetchedLabel}</span>
          <a href={result.sourceUrl} target="_blank" rel="noopener noreferrer">查看账号主页 <ArrowUpRight aria-hidden /></a>
        </div>

        <div className={styles.accountKpiRail} role="list" aria-label="账号关键指标">
          <div role="listitem"><small>粉丝</small><strong>{displayCount(profile?.followers)}</strong><span>平台累计</span></div>
          <div role="listitem"><small>关注</small><strong>{displayCount(profile?.following)}</strong><span>平台累计</span></div>
          <div role="listitem"><small>获赞</small><strong>{displayCount(profile?.likes)}</strong><span>平台累计</span></div>
          <div role="listitem"><small>作品</small><strong>{displayCount(profile?.works)}</strong><span>平台累计</span></div>
          <div role="listitem"><small>样本均播</small><strong>{displayCompactMetric(snapshot.averageViews)}</strong><span>{snapshot.measuredViews} 个有效样本</span></div>
          <div role="listitem"><small>可见互动率</small><strong>{displayPercent(snapshot.engagementRate)}</strong><span>已返回互动 ÷ 播放</span></div>
          <div role="listitem"><small>样本播放 / 粉丝</small><strong>{displayPercent(snapshot.viewToFollowerRate)}</strong><span>均播 ÷ 粉丝</span></div>
          <div role="listitem"><small>可见总互动</small><strong>{snapshot.measuredInteractions ? displayCompactMetric(snapshot.totalInteractions) : "—"}</strong><span>{snapshot.measuredInteractions} 个有效样本</span></div>
        </div>
      </header>

      {!!result.warnings?.length && (
        <div className={styles.warningList} role="status">
          {result.warnings.map((warning) => (
            <div className={styles.notice} key={warning}><CircleAlert aria-hidden /> {warning}</div>
          ))}
        </div>
      )}

      <div className={styles.accountStage}>
        <section className={styles.performanceBoard}>
          <header className={styles.dataPanelHeader}>
            <div><Trophy aria-hidden /><span><strong>{snapshot.rankingLabel === "平台顺序" ? "近期作品索引" : "内容表现排行"}</strong><small>{snapshot.rankingLabel === "平台顺序" ? "暂无可比较的表现指标" : `按样本${snapshot.rankingLabel}排序`}</small></span></div>
            <span>{snapshot.sampleCount} 个公开样本</span>
          </header>
          {chartWorks.length > 0 ? (
            <div className={styles.performanceRows}>
              {chartWorks.map((item, rank) => {
                const width = item.score > 0 ? Math.max(4, (item.score / snapshot.maxScore) * 100) : 0;
                return (
                  <button
                    type="button"
                    key={item.work.id || `${item.work.pageUrl}-${item.index}`}
                    className={currentDatum?.work === item.work ? styles.performanceRowActive : ""}
                    aria-pressed={currentDatum?.work === item.work}
                    title={titleOf(item.work)}
                    onClick={() => onSelectWork(item.work)}
                  >
                    <b>{String(rank + 1).padStart(2, "0")}</b>
                    <span className={styles.performanceTitle}>{titleOf(item.work)}</span>
                    <span className={styles.performanceBar} aria-hidden>
                      <i style={{ "--bar-scale": width / 100 } as React.CSSProperties} />
                    </span>
                    <strong>{displayCompactMetric(snapshot.maxScore > 0 ? item.score : null)}</strong>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className={styles.dataEmpty}>平台没有返回可用于排行的播放或互动数据。</div>
          )}
        </section>

        <aside className={styles.focusSample}>
          <header className={styles.dataPanelHeader}>
            <div><Target aria-hidden /><span><strong>聚焦样本</strong><small>点击左侧排行切换</small></span></div>
            {currentDatum && <span>#{String(snapshot.rankedWorks.indexOf(currentDatum) + 1).padStart(2, "0")}</span>}
          </header>
          {currentDatum ? (
            <>
              <div className={styles.focusMedia}>
                <WorkCover work={currentDatum.work} platform={result.platform} />
                {currentDatum.work.duration && <span className={styles.duration}><Clock3 aria-hidden /> {currentDatum.work.duration}</span>}
              </div>
              <div className={styles.focusCopy}>
                <h3>{titleOf(currentDatum.work)}</h3>
                <time>{displayDate(currentDatum.work.publishedAt) || "发布时间未知"}</time>
              </div>
              <div className={styles.focusMetrics}>
                <div><small>播放</small><strong>{displayCompactMetric(currentDatum.views)}</strong></div>
                <div><small>可见互动</small><strong>{displayCompactMetric(currentDatum.hasInteractionData ? currentDatum.interactions : null)}</strong></div>
                <div><small>可见互动率</small><strong>{displayPercent(currentDatum.engagementRate)}</strong></div>
              </div>
              {currentDatum.work.pageUrl && (
                <div className={styles.focusActions}>
                  <a href={currentDatum.work.pageUrl} target="_blank" rel="noopener noreferrer">查看作品 <ArrowUpRight aria-hidden /></a>
                  {isVideoWork(currentDatum.work) && downloaderPlatforms.includes(result.platform) && (
                    <button type="button" onClick={() => onDownloadWork(currentDatum.work)}><Download aria-hidden /> 下载原片</button>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className={styles.dataEmpty}>暂时没有可聚焦的公开作品。</div>
          )}
        </aside>
      </div>

      <div className={styles.accountSignals}>
        <section className={styles.signalPanel}>
          <header className={styles.dataPanelHeader}>
            <div><Activity aria-hidden /><span><strong>样本信号</strong><small>只描述本次公开样本</small></span></div>
          </header>
          <div className={styles.signalGrid}>
            <div><span><Gauge aria-hidden /> 中位播放</span><strong>{displayCompactMetric(snapshot.medianViews)}</strong><small>减少单条爆款对均值的干扰</small></div>
            <div><span><BarChart3 aria-hidden /> 爆款集中度</span><strong>{displayPercent(snapshot.topConcentration)}</strong><small>头部作品占样本总播放</small></div>
            <div><span><CalendarDays aria-hidden /> 样本发布频率</span><strong>{snapshot.postsPerWeek === null ? "—" : `${snapshot.postsPerWeek.toFixed(1)} 条/周`}</strong><small>{snapshot.measuredPublished} 个定时样本 · {publishedRange}</small></div>
            <div><span><Activity aria-hidden /> 平均可见互动</span><strong>{displayCompactMetric(snapshot.averageInteractions)}</strong><small>{snapshot.measuredInteractions} 个有效样本</small></div>
          </div>
        </section>

        <section className={styles.interactionPanel}>
          <header className={styles.dataPanelHeader}>
            <div><BarChart3 aria-hidden /><span><strong>互动构成</strong><small>{snapshot.measuredInteractions ? `${displayCompactMetric(snapshot.totalInteractions)} 次可见互动` : "暂无有效互动样本"}</small></span></div>
          </header>
          {snapshot.measuredInteractions > 0 && interactionTotal > 0 ? (
            <>
              <div className={styles.interactionTrack} role="img" aria-label={snapshot.interactionParts.map((item) => `${item.label}${displayCompactMetric(item.measured ? item.value : null)}`).join("，")}>
                {snapshot.interactionParts.filter((item) => item.value > 0).map((item) => (
                  <i key={item.key} data-part={item.key} style={{ flexGrow: item.value }} />
                ))}
              </div>
              <div className={styles.interactionLegend}>
                {snapshot.interactionParts.map((item) => (
                  <span key={item.key} data-part={item.key}><i />{item.label}<strong>{displayCompactMetric(item.measured ? item.value : null)}</strong></span>
                ))}
              </div>
            </>
          ) : snapshot.measuredInteractions > 0 ? (
            <div className={styles.dataEmpty}>平台返回的互动指标均为 0。</div>
          ) : (
            <div className={styles.dataEmpty}>平台没有返回点赞、评论、分享或收藏数据。</div>
          )}
          <p className={styles.scopeNote}>这是当前抓取样本的横截面，不代表粉丝增长趋势或行业基准。</p>
        </section>
      </div>

      <section className={styles.accountWorks}>
        <header className={styles.sectionHeader}>
          <div><h2>内容样本</h2><p>从封面、标题与数据一起判断什么值得复用。</p></div>
          <span>{snapshot.sampleCount} 个样本 · {publishedRange}</span>
        </header>
        {snapshot.works.length > 0 ? (
          <div className={styles.accountWorkGrid}>
            {snapshot.works.map((item) => (
              <button
                type="button"
                key={item.work.id || `${item.work.pageUrl}-${item.index}`}
                className={currentDatum?.work === item.work ? styles.accountWorkActive : ""}
                aria-pressed={currentDatum?.work === item.work}
                title={titleOf(item.work)}
                onClick={() => onSelectWork(item.work)}
              >
                <span className={styles.accountWorkMedia}>
                  <WorkCover work={item.work} platform={result.platform} />
                  {currentDatum?.work === item.work && <em className={styles.accountWorkState}>聚焦</em>}
                </span>
                <span className={styles.accountWorkCopy}><b>{titleOf(item.work)}</b><small>{displayCompactMetric(item.views)} 播放 · {displayCompactMetric(item.hasInteractionData ? item.interactions : null)} 互动</small></span>
              </button>
            ))}
          </div>
        ) : (
          <div className={styles.dataEmpty}>平台返回了账号资料，但没有可展示的公开作品。</div>
        )}
      </section>

      <section className={styles.accountStrategy}>
        <header className={styles.sectionHeader}>
          <div><h2>AI 账号策略拆解</h2><p>把样本数据转成定位、内容支柱与下一轮测试动作。</p></div>
          <span>只使用本次公开样本</span>
        </header>
        <div className={styles.strategyGrid}>
          <article className={styles.strategyControl}>
            <label className={styles.focusField}>
              <span>你希望重点分析什么</span>
              <textarea rows={7} value={focus} onChange={(event) => onFocusChange(event.target.value)} maxLength={4000} />
              <small>{focus.length} / 4000</small>
            </label>
            <div className={styles.strategyScope}>
              <span><Target aria-hidden />账号定位</span>
              <span><Trophy aria-hidden />爆款差异</span>
              <span><BarChart3 aria-hidden />内容支柱</span>
              <span><CalendarDays aria-hidden />发布节奏</span>
            </div>
            <button
              type="button"
              className={styles.primaryButton}
              disabled={(!profile && result.works.length === 0) || busy || !!runDetails}
              onClick={onRun}
            >
              {busy ? <Loader2 className={styles.spin} aria-hidden /> : <ScanSearch aria-hidden />}
              {busy ? "正在启动分析" : "生成账号策略"}
            </button>
          </article>
          <div className={styles.strategyOutput}>
            {skillError && <div className={styles.error} role="alert"><CircleAlert aria-hidden /><span>{skillError}</span></div>}
            {runDetails || (
              <div className={styles.strategyEmpty}>
                <Sparkles aria-hidden />
                <div><strong>策略报告将在这里展开</strong><p>AI 会引用当前账号资料和 {snapshot.sampleCount} 个作品样本，不会编造平台未返回的指标。</p></div>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

interface ContentDashboardProps {
  result: SocialInspectVO;
  work: SocialWorkVO;
  focus: string;
  busy: boolean;
  runDetails: React.ReactNode;
  skillError: string;
  canDownload: boolean;
  onFocusChange: (value: string) => void;
  onRun: () => void;
  onDownload: () => void;
}

function ContentDashboard({
  result,
  work,
  focus,
  busy,
  runDetails,
  skillError,
  canDownload,
  onFocusChange,
  onRun,
  onDownload,
}: ContentDashboardProps) {
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const snapshot = buildWorkSnapshot(work);
  const meta = platformMeta(result.platform);
  const interactionTotal = snapshot.interactions ?? 0;
  const author = result.profile;
  const videoWork = isVideoWork(work);
  const imageURLs = videoWork ? [] : workImageSources(work);
  const mediaLabel = work.mediaType === "image" || imageURLs.length > 0 ? "图文作品" : videoWork ? "视频作品" : "公开作品";
  const selectedImageURL = imageURLs[Math.min(selectedImageIndex, Math.max(0, imageURLs.length - 1))] || work.coverUrl;
  const analysisAssetAvailable = videoWork ? !!work.mediaUrl : imageURLs.length > 0;
  const sourceURL = work.pageUrl || result.sourceUrl;

  return (
    <div className={styles.contentDashboard} style={{ "--platform": meta.color } as React.CSSProperties}>
      <header className={styles.contentHero}>
        <div className={styles.contentMedia} data-kind={videoWork ? "video" : "image"}>
          <WorkCover work={selectedImageURL && !videoWork ? { ...work, coverUrl: selectedImageURL } : work} platform={result.platform} alt={`作品画面：${titleOf(work)}`} />
          <span className={styles.sourceBadge}><PlatformMark platform={result.platform} small /> {result.platformName}</span>
          {work.duration && <span className={styles.duration}><Clock3 aria-hidden /> {work.duration}</span>}
          {imageURLs.length > 1 && (
            <div className={styles.contentImageRail} role="group" aria-label={`作品图片，共 ${imageURLs.length} 张`}>
              {imageURLs.map((imageURL, index) => (
                <button type="button" key={imageURL} aria-label={`查看第 ${index + 1} 张图片`} aria-pressed={selectedImageIndex === index} onClick={() => setSelectedImageIndex(index)}>
                  <WorkCover work={{ ...work, coverUrl: imageURL }} platform={result.platform} />
                </button>
              ))}
            </div>
          )}
        </div>
        <div className={styles.contentBrief}>
          <div className={styles.contentAuthor}>
            <span className={styles.contentAuthorAvatar}><ProfileAvatar url={author?.avatarUrl} platform={result.platform} /></span>
            <span><small>{author?.name || author?.handle || result.platformName}</small><b>{mediaLabel}{imageURLs.length > 1 ? ` · ${imageURLs.length} 张` : ""}</b></span>
          </div>
          <h2>{titleOf(work)}</h2>
          <p>{work.description && work.description !== work.title ? work.description : "平台暂未返回独立作品文案"}</p>
          <div className={styles.contentMeta}>
            <span><CalendarDays aria-hidden />{displayDate(work.publishedAt) || "发布时间未知"}</span>
            <span>{videoWork ? <FileVideo aria-hidden /> : <Film aria-hidden />}{videoWork ? work.duration || "时长未知" : imageURLs.length ? `${imageURLs.length} 张图片` : "图片未返回"}</span>
            <span><Activity aria-hidden />{snapshot.measuredFields + (snapshot.views !== null ? 1 : 0)} / 5 项数据可用</span>
          </div>
          <div className={styles.contentActions}>
            <a href={sourceURL} target="_blank" rel="noopener noreferrer">查看原作品 <ArrowUpRight aria-hidden /></a>
            {canDownload && <button type="button" onClick={onDownload}><Download aria-hidden /> 下载原片</button>}
          </div>
        </div>
        <div className={styles.contentKpiRail} role="list" aria-label="作品关键指标">
          <div role="listitem"><small>播放</small><strong>{displayCompactMetric(snapshot.views)}</strong></div>
          {snapshot.interactionParts.map((item) => (
            <div role="listitem" key={item.key}><small>{item.label}</small><strong>{displayCompactMetric(item.value)}</strong></div>
          ))}
          <div role="listitem"><small>可见互动率</small><strong>{displayPercent(snapshot.engagementRate)}</strong></div>
        </div>
      </header>

      {!!result.warnings?.length && (
        <div className={styles.warningList} role="status">
          {result.warnings.map((warning) => (
            <div className={styles.notice} key={warning}><CircleAlert aria-hidden /> {warning}</div>
          ))}
        </div>
      )}

      <div className={styles.contentSignals}>
        <section className={styles.contentInteraction}>
          <header className={styles.dataPanelHeader}>
            <div><BarChart3 aria-hidden /><span><strong>互动结构</strong><small>仅汇总平台已返回的公开指标</small></span></div>
            <span>{displayCompactMetric(snapshot.interactions)} 次可见互动</span>
          </header>
          {snapshot.measuredFields > 0 && interactionTotal > 0 ? (
            <>
              <div className={styles.interactionTrack} role="img" aria-label={snapshot.interactionParts.map((item) => `${item.label}${displayCompactMetric(item.value)}`).join("，")}>
                {snapshot.interactionParts.filter((item) => (item.value ?? 0) > 0).map((item) => (
                  <i key={item.key} data-part={item.key} style={{ flexGrow: item.value ?? 0 }} />
                ))}
              </div>
              <div className={styles.interactionLegend}>
                {snapshot.interactionParts.map((item) => (
                  <span key={item.key} data-part={item.key}>
                    <i />{item.label}<strong>{displayCompactMetric(item.value)}{item.rate !== null ? ` · ${displayPercent(item.rate)}` : ""}</strong>
                  </span>
                ))}
              </div>
            </>
          ) : snapshot.measuredFields > 0 ? (
            <div className={styles.dataEmpty}>平台返回的互动指标均为 0。</div>
          ) : (
            <div className={styles.dataEmpty}>平台没有返回点赞、评论、分享或收藏数据。</div>
          )}
        </section>
        <section className={styles.contentFacts}>
          <header className={styles.dataPanelHeader}>
            <div><Gauge aria-hidden /><span><strong>作品数据口径</strong><small>当前公开快照</small></span></div>
          </header>
          <dl>
            <div><dt>作品类型</dt><dd>{mediaLabel}</dd></div>
            <div><dt>发布时间</dt><dd>{displayDate(work.publishedAt) || "未返回"}</dd></div>
            <div><dt>{videoWork ? "作品时长" : "图片数量"}</dt><dd>{videoWork ? work.duration || "未返回" : imageURLs.length ? `${imageURLs.length} 张` : "未返回"}</dd></div>
            <div><dt>可见互动</dt><dd>{displayCompactMetric(snapshot.interactions)}</dd></div>
            <div><dt>可见互动率</dt><dd>{displayPercent(snapshot.engagementRate)}</dd></div>
          </dl>
          <p>互动率 = 平台已返回的点赞、评论、分享、收藏之和 ÷ 播放量；缺失字段不会按 0 处理。</p>
        </section>
      </div>

      <section className={styles.contentStrategy}>
        <header className={styles.sectionHeader}>
          <div><h2>{videoWork ? "AI 视频深度拆解" : "AI 图文深度拆解"}</h2><p>{videoWork ? "归档原片后提取音轨与关键帧，所有判断要求附带时间码证据。" : "基于真实图片分析主体、构图、文案、情绪和传播钩子，区分可见事实与推断。"}</p></div>
          <span>页面关闭后仍可恢复</span>
        </header>
        <div className={styles.strategyGrid}>
          <article className={styles.strategyControl}>
            <label className={styles.focusField}>
              <span>你希望重点分析什么</span>
              <textarea rows={7} value={focus} onChange={(event) => onFocusChange(event.target.value)} maxLength={4000} />
              <small>{focus.length} / 4000</small>
            </label>
            <div className={styles.strategyScope}>
              <span><Target aria-hidden />{videoWork ? "开头钩子" : "视觉主体"}</span>
              <span><Film aria-hidden />{videoWork ? "叙事结构" : "构图层级"}</span>
              <span><Activity aria-hidden />{videoWork ? "镜头节奏" : "色彩文案"}</span>
              <span><Sparkles aria-hidden />复用方法</span>
            </div>
            <button type="button" className={styles.primaryButton} disabled={!analysisAssetAvailable || busy || !!runDetails} onClick={onRun}>
              {busy ? <Loader2 className={styles.spin} aria-hidden /> : <ScanSearch aria-hidden />}
              {busy ? "正在归档并启动" : videoWork ? "开始视频拆解" : "开始图文拆解"}
            </button>
            {!analysisAssetAvailable && (
              <div className={styles.notice}><CircleAlert aria-hidden /> 当前平台只返回了作品信息，没有可归档的{videoWork ? "视频直链" : "图片"}；可以查看数据，但暂时无法运行 AI 分析。</div>
            )}
          </article>
          <div className={styles.strategyOutput}>
            {skillError && <div className={styles.error} role="alert"><CircleAlert aria-hidden /><span>{skillError}</span></div>}
            {runDetails || (
              <div className={styles.strategyEmpty}>
                <ScanSearch aria-hidden />
                <div><strong>{videoWork ? "时间码报告将在这里展开" : "视觉分析报告将在这里展开"}</strong><p>{videoWork ? "报告将覆盖转写、开头钩子、叙事结构、镜头节奏、情绪变化与可复用方法。" : "报告将覆盖可见主体、视觉层级、构图、色彩光线、文案、情绪与可复用方法。"}</p></div>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

export default function AnalysisWorkbench() {
  const { user, initialized } = useAuth();
  const ensureSession = useAuthStore((state) => state.ensureSession);
  const [tab, setTab] = useState<WorkbenchTab>("breakdown");
  const [kind, setKind] = useState<SocialAnalysisKind>("content");
  const [url, setURL] = useState("");
  const [focus, setFocus] = useState(DEFAULT_FOCUS);
  const [status, setStatus] = useState<SocialAnalysisStatusVO | null>(null);
  const [statusRefresh, setStatusRefresh] = useState(0);
  const [statusChecking, setStatusChecking] = useState(false);
  const [statusError, setStatusError] = useState(false);
  const [downloaderCapabilities, setDownloaderCapabilities] = useState<VideoDownloaderCapabilitiesVO | null>(null);
  const [downloaderStatusError, setDownloaderStatusError] = useState(false);
  const [downloaderRefresh, setDownloaderRefresh] = useState(0);
  const [downloadSource, setDownloadSource] = useState("");
  const [downloadQuality, setDownloadQuality] = useState<VideoDownloadQuality>("compat");
  const [downloadResult, setDownloadResult] = useState<VideoDownloadResolveVO | null>(null);
  const [downloadError, setDownloadError] = useState("");
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [result, setResult] = useState<SocialInspectVO | null>(null);
  const [selectedWork, setSelectedWork] = useState<SocialWorkVO | null>(null);
  const [loading, setLoading] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [error, setError] = useState("");
  const videoSkillRef = useRef<SkillVO | null>(null);
  const imageSkillRef = useRef<SkillVO | null>(null);
  const accountSkillRef = useRef<SkillVO | null>(null);
  const inspectBusyRef = useRef(false);
  const analysisBusyRef = useRef(false);
  const inspectEpochRef = useRef(0);
  const analysisEpochRef = useRef(0);
  const downloadBusyRef = useRef(false);
  const downloadEpochRef = useRef(0);
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
    downloadEpochRef.current += 1;
    inspectBusyRef.current = false;
    analysisBusyRef.current = false;
    setLoading(false);
    setArchiving(false);
    setStatus(null);
    setStatusChecking(false);
    setStatusError(false);
    setDownloaderCapabilities(null);
    setDownloaderStatusError(false);
    setDownloadResult(null);
    setDownloadError("");
    setDownloadBusy(false);
    downloadBusyRef.current = false;
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
    void socialAnalysisApi.downloaderPlatforms().then((response) => {
      if (cancelled) return;
      if (response.success && response.data) {
        setDownloaderCapabilities(response.data);
        setDownloaderStatusError(false);
      } else {
        setDownloaderCapabilities(null);
        setDownloaderStatusError(true);
      }
    });
    return () => { cancelled = true; };
  }, [downloaderRefresh, ownerUserId]);

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
  const downloaderPlatforms = downloaderCapabilities?.platforms ?? [];
  const downloaderReady = downloaderCapabilities?.enabled === true;
  const downloaderStateLabel = initialized && !user
    ? "登录后可用"
    : downloaderStatusError
      ? "检查失败"
      : downloaderCapabilities
        ? downloaderReady ? "下载器可用" : "下载器未启用"
        : "正在检查";
  // 两个页签共用同一套状态词汇,值随当前页签背后的服务切换:拆解看 TikHub
  // 解析,下载看 Relay 下载器。此前两块各写一遍状态,是重复与错位的来源。
  const serviceReady = tab === "breakdown" ? !!status?.enabled && !!status?.configured : downloaderReady;
  const serviceLabel = tab === "breakdown" ? statusLabel : downloaderStateLabel;
  const serviceBusy = tab === "breakdown"
    ? !user || statusChecking
    : !user || downloadBusy || (!downloaderCapabilities && !downloaderStatusError);
  const recheckService = () => {
    if (tab === "breakdown") {
      setStatus(null);
      setStatusError(false);
      setError("");
      setStatusRefresh((value) => value + 1);
      return;
    }
    setDownloaderCapabilities(null);
    setDownloaderStatusError(false);
    setDownloaderRefresh((value) => value + 1);
  };

  const inspect = async () => {
    if (inspectBusyRef.current || !url.trim()) return;
    if (!skillRun.run && skillRun.error) skillRun.clear();
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
      if (
        response.data.kind === "content" &&
        response.data.content &&
        !isVideoWork(response.data.content) &&
        focus === DEFAULT_FOCUS
      ) {
        setFocus(IMAGE_DEFAULT_FOCUS);
      } else if (
        response.data.kind === "content" &&
        response.data.content &&
        isVideoWork(response.data.content) &&
        focus === IMAGE_DEFAULT_FOCUS
      ) {
        setFocus(DEFAULT_FOCUS);
      }
    } finally {
      if (epoch === inspectEpochRef.current) {
        inspectBusyRef.current = false;
        setLoading(false);
      }
    }
  };

  const loadAnalysisSkill = async (mode: "account" | "video" | "image"): Promise<SkillVO | null> => {
    const cache = mode === "account" ? accountSkillRef : mode === "image" ? imageSkillRef : videoSkillRef;
    if (cache.current) return cache.current;
    const stableId = mode === "account"
      ? status?.accountAnalysisSkillId
      : mode === "image"
        ? status?.imageAnalysisSkillId
        : status?.videoAnalysisSkillId;
    const title = mode === "account" ? "账号拆解" : mode === "image" ? "图片分析" : "视频分析";
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
    const contentSkillMode = currentWork && isVideoWork(currentWork) ? "video" : "image";
    const contentImageURLs = currentWork ? workImageSources(currentWork) : [];
    const contentAssetURL = contentSkillMode === "video" ? currentWork?.mediaUrl : contentImageURLs[0];
    if (kind === "content" && !contentAssetURL) return;
    const skillMode = kind === "account" ? "account" : contentSkillMode;
    const skillLabel = skillMode === "account" ? "账号拆解" : skillMode === "image" ? "图片分析" : "视频分析";
    analysisBusyRef.current = true;
    const epoch = ++analysisEpochRef.current;
    setArchiving(true);
    setError("");
    try {
      if (!await ensureSession()) return;
      const skill = await loadAnalysisSkill(skillMode);
      if (epoch !== analysisEpochRef.current) return;
      if (!skill) {
        setError(`${skillLabel}技能未上架，请联系管理员检查技能配置`);
        return;
      }
      let assets: Array<{ id?: string; type: "video" | "image"; url?: string; name?: string; role?: string; metadata?: Record<string, unknown> }> = [];
      let prompt = "";
      const sourceURL = kind === "account"
        ? result.sourceUrl
        : currentWork?.pageUrl || result.sourceUrl || "";
      if (kind === "content" && currentWork && contentAssetURL) {
        const mediaCandidates = contentSkillMode === "video"
          ? [...new Set([contentAssetURL, ...(currentWork.mediaUrls ?? [])].filter(Boolean))].slice(0, 5)
          : contentImageURLs;
        const archivedAssets: typeof assets = [];
        const archivedIDs = new Set<string>();
        let lastArchive = null as Awaited<ReturnType<typeof fileApi.saveFromUrl>> | null;
        for (const candidate of mediaCandidates) {
          const archived = await fileApi.saveFromUrl({
            url: candidate,
            fileType: contentSkillMode,
            category: FileCategory.GENERAL,
            originalName: contentSkillMode === "video"
              ? safeFileName(titleOf(currentWork), candidate)
              : safeImageFileName(titleOf(currentWork), candidate),
          });
          if (epoch !== analysisEpochRef.current) return;
          lastArchive = archived;
          if (archived.success && archived.data) {
            if (archivedIDs.has(archived.data.id)) continue;
            archivedIDs.add(archived.data.id);
            archivedAssets.push({
              id: archived.data.id,
              type: contentSkillMode,
              url: archived.data.fileUrl,
              name: archived.data.originalName,
              role: contentSkillMode === "video" ? "source-video" : `source-image-${archivedAssets.length + 1}`,
              metadata: { platform: currentPlatform, sourceUrl: sourceURL },
            });
            if (contentSkillMode === "video") break;
            continue;
          }
          if (contentSkillMode === "video" && archived.code !== 0 && archived.code !== 400 && archived.code !== 408) break;
        }
        if (archivedAssets.length === 0) {
          setError(`${contentSkillMode === "video" ? "视频" : "图片"}归档失败：${lastArchive?.message || "暂时无法读取素材"}。${contentSkillMode === "video" ? "已尝试可用镜像；" : ""}如果页面已打开较久，请重新解析作品以刷新临时地址。`);
          return;
        }
        if (contentSkillMode === "image" && archivedAssets.length < mediaCandidates.length) {
          toast.info(`已读取 ${archivedAssets.length}/${mediaCandidates.length} 张图片，将使用可用图片继续分析`);
        }
        assets = archivedAssets;
        prompt = contentPrompt(result, currentWork, focus, contentSkillMode === "video");
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
          parameters: { platform: currentPlatform, sourceUrl: sourceURL, sourceFetchedAt: result.fetchedAt, analysisMode: skillMode },
        },
      });
      if (epoch !== analysisEpochRef.current) return;
      if (!started) {
        setError(skillRun.error || `${skillLabel}技能启动失败，请稍后重试`);
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

  const resolveVideoDownload = async (qualityOverride?: VideoDownloadQuality) => {
    if (downloadBusyRef.current || !downloadSource.trim()) return;
    // 结果面板里切换画质会立即重解析,此时 state 尚未更新,必须用传入值。
    const targetQuality = qualityOverride ?? downloadQuality;
    // 切换画质是在已有结果上换一档,保留当前结果原地更新;清空会让结果区卸载、
    // 掉进 busy 分支再挂载,视觉上就是「刷一下」。
    const replaceInPlace = qualityOverride !== undefined && !!downloadResult;
    const sourceURL = extractDownloadURL(downloadSource);
    if (!sourceURL) {
      setDownloadError("请输入有效的公开视频 HTTPS 链接");
      return;
    }
    downloadBusyRef.current = true;
    const epoch = ++downloadEpochRef.current;
    setDownloadBusy(true);
    setDownloadError("");
    if (!replaceInPlace) setDownloadResult(null);
    try {
      if (!await ensureSession()) return;
      const response = await socialAnalysisApi.resolveDownload({ url: sourceURL, quality: targetQuality });
      if (epoch !== downloadEpochRef.current) return;
      if (!response.success || !response.data) {
        setDownloadError(response.code === 429 ? "请求过于频繁，请稍后再试" : response.message || "视频解析失败，请检查链接后重试");
        return;
      }
      setDownloadResult(response.data);
    } finally {
      if (epoch === downloadEpochRef.current) {
        downloadBusyRef.current = false;
        setDownloadBusy(false);
      }
    }
  };

  const downloadResolvedVideo = () => {
    if (!downloadResult) return;
    if (downloadResult.expiresAt * 1000 <= Date.now()) {
      setDownloadResult(null);
      setDownloadError("下载地址已经过期，请重新解析视频");
      return;
    }
    startNativeDownload(downloadResult.downloadUrl);
    toast.success("已交给浏览器下载，请查看默认下载目录");
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
      const storedMode = parameters.analysisMode === "account" || parameters.analysisMode === "image" || parameters.analysisMode === "video"
        ? parameters.analysisMode
        : "";
      const accountRun = storedMode === "account" || (!storedMode && (
        skillRun.run?.skillId === status?.accountAnalysisSkillId || prompt.includes('"recentWorks"')
      ));
      const imageRun = storedMode === "image" || (!storedMode && skillRun.run?.skillId === status?.imageAnalysisSkillId);
      if (sourceUrl) setURL(sourceUrl);
      setKind(accountRun ? "account" : "content");
      const wrappedRequest = /<user_request>\s*([\s\S]*?)\s*<\/user_request>/.exec(prompt)?.[1]?.trim();
      if (accountRun) setFocus(wrappedRequest || ACCOUNT_DEFAULT_FOCUS);
      else setFocus(wrappedRequest || prompt.split("\n平台：", 1)[0]?.trim() || (imageRun ? IMAGE_DEFAULT_FOCUS : DEFAULT_FOCUS));
    }
    // 重新编辑始终回到拆解页签:运行面板只属于拆解,留在下载页会失去上下文。
    setTab("breakdown");
    setError("");
    setResult(null);
    setSelectedWork(null);
    skillRun.clear();
  };

  // ARIA tabs 模式:roving tabindex 让整组页签只占一个 Tab 停靠点,
  // 因此必须由方向键在页签间移动——只做 tabIndex 不接方向键,
  // 键盘用户会被困在当前页签上,永远到不了另一个。
  const tabRefs = useRef<Partial<Record<WorkbenchTab, HTMLButtonElement | null>>>({});
  const focusTab = (next: WorkbenchTab) => {
    setTab(next);
    tabRefs.current[next]?.focus();
  };
  const onTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const order: WorkbenchTab[] = ["breakdown", "download"];
    const index = order.indexOf(tab);
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const step = event.key === "ArrowRight" ? 1 : -1;
      focusTab(order[(index + step + order.length) % order.length]);
      return;
    }
    if (event.key === "Home") { event.preventDefault(); focusTab(order[0]); return; }
    if (event.key === "End") { event.preventDefault(); focusTab(order[order.length - 1]); }
  };

  // 链接能否解析出可用地址:输入框的标记与 data 属性共用同一个判断,
  // 分别计算容易两边漂移。
  const recognizedSource = extractDownloadURL(downloadSource);

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
  const currentAnalysisSource = result
    ? result.kind === "account"
      ? result.sourceUrl.trim()
      : (currentWork?.pageUrl || result.sourceUrl).trim()
    : "";
  const activeRunContext = analysisRunContext(skillRun.run?.input);
  // A restored or previous report must never be rendered beneath a different
  // account/work. Without this fence, parsing account B after account A makes
  // A's report look like B's and also keeps B's analysis button disabled.
  const runMatchesCurrentResult = !result || !skillRun.run
    ? true
    : !!activeRunContext.sourceUrl &&
      activeRunContext.sourceUrl === currentAnalysisSource &&
      activeRunContext.sourceFetchedAt !== null &&
      activeRunContext.sourceFetchedAt === result.fetchedAt;
  const contextualRunDetails = runMatchesCurrentResult ? runDetails : null;
  const contextualSkillError = runMatchesCurrentResult ? skillRun.error : "";

  return (
    <main className={styles.page}>
      <div className={styles.canvas}>
        <header className={styles.pageHeader}>
          <h1>拆解</h1>
          <p>粘贴一条公开链接：把原片取回本地，或让 AI 拆开它为什么有效。</p>
        </header>

        <div className={styles.tabBar}>
          <div className={styles.tabs} role="tablist" aria-label="拆解工作台">
            <button
              type="button"
              role="tab"
              id="analysis-tab-breakdown"
              aria-selected={tab === "breakdown"}
              aria-controls="analysis-panel-breakdown"
              tabIndex={tab === "breakdown" ? 0 : -1}
              ref={(node) => { tabRefs.current.breakdown = node; }}
              className={tab === "breakdown" ? styles.tabActive : ""}
              onClick={() => setTab("breakdown")}
              onKeyDown={onTabKeyDown}
            >
              内容拆解
            </button>
            <button
              type="button"
              role="tab"
              id="analysis-tab-download"
              aria-selected={tab === "download"}
              aria-controls="analysis-panel-download"
              tabIndex={tab === "download" ? 0 : -1}
              ref={(node) => { tabRefs.current.download = node; }}
              className={tab === "download" ? styles.tabActive : ""}
              onClick={() => setTab("download")}
              onKeyDown={onTabKeyDown}
            >
              视频下载
            </button>
          </div>
          <button
            type="button"
            className={styles.serviceState}
            data-ready={serviceReady ? "true" : "false"}
            disabled={serviceBusy}
            title={user ? "点击重新检查服务" : "登录后检查服务"}
            aria-live="polite"
            onClick={recheckService}
          >
            <i /> {serviceLabel}
          </button>
        </div>

        {tab === "breakdown" ? (
          <div className={styles.panel} role="tabpanel" id="analysis-panel-breakdown" aria-labelledby="analysis-tab-breakdown">
            <section className={`${styles.composer}${result || loading ? ` ${styles.composerWithDashboard}` : ""}`}>
              <div className={styles.modeSwitch} aria-label="拆解对象">
                <button type="button" aria-pressed={kind === "content"} disabled={loading || archiving} className={kind === "content" ? styles.modeActive : ""} onClick={() => { setKind("content"); setFocus(DEFAULT_FOCUS); setResult(null); setSelectedWork(null); setError(""); }}>
                  <Film aria-hidden /> 单个作品
                </button>
                <button type="button" aria-pressed={kind === "account"} disabled={loading || archiving} className={kind === "account" ? styles.modeActive : ""} onClick={() => { setKind("account"); setFocus(ACCOUNT_DEFAULT_FOCUS); setResult(null); setSelectedWork(null); setError(""); }}>
                  <UserRoundSearch aria-hidden /> 整个账号
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
              <div className={styles.composerFooter}>
                <span className={styles.footNote}><ShieldCheck aria-hidden /> 仅支持公开内容</span>
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
              <div className={styles.platformRow}>
                <span className={styles.platformLead}>支持</span>
                {PLATFORMS.map((item) => (
                  <span key={item.key} className={styles.platformChip} title={item.hint}>
                    <PlatformMark platform={item.key} small />{item.label}
                  </span>
                ))}
              </div>
              {/* 服务未就绪时按钮会置灰。下载页早已给出原因说明,拆解页此前
                  只是置灰,用户无从判断是自己链接不对还是服务没开。 */}
              {user && status && !status.enabled && (
                <div className={styles.notice}><CircleAlert aria-hidden /> 内容拆解服务当前已停用，请联系管理员在系统配置中开启。</div>
              )}
              {user && status?.enabled && !status.configured && (
                <div className={styles.notice}><CircleAlert aria-hidden /> 内容拆解服务尚未配置，请联系管理员在系统配置中填写 TikHub 令牌。</div>
              )}
              {error && (
                <div className={styles.error} role="alert"><CircleAlert aria-hidden /><span>{error}</span></div>
              )}
            </section>

            {result ? (
              <section className={styles.resultSection}>
                {result.kind === "account" ? (
                  <AccountDashboard
                    result={result}
                    currentWork={currentWork}
                    focus={focus}
                    busy={archiving || skillRun.loading}
                    runDetails={contextualRunDetails}
                    skillError={contextualSkillError}
                    downloaderPlatforms={downloaderPlatforms}
                    onSelectWork={setSelectedWork}
                    onFocusChange={setFocus}
                    onRun={() => void startDeepAnalysis()}
                    onDownloadWork={(work) => {
                      setDownloadSource(work.pageUrl || "");
                      setDownloadResult(null);
                      setDownloadError("");
                      setTab("download");
                    }}
                  />
                ) : (
                  currentWork ? (
                    <ContentDashboard
                      key={currentWork.id || currentWork.pageUrl || result.fetchedAt}
                      result={result}
                      work={currentWork}
                      focus={focus}
                      busy={archiving || skillRun.loading}
                      runDetails={contextualRunDetails}
                      skillError={contextualSkillError}
                      canDownload={!!currentWork.pageUrl && isVideoWork(currentWork) && downloaderPlatforms.includes(result.platform)}
                      onFocusChange={setFocus}
                      onRun={() => void startDeepAnalysis()}
                      onDownload={() => {
                        if (!currentWork.pageUrl) return;
                        setDownloadSource(currentWork.pageUrl);
                        setDownloadResult(null);
                        setDownloadError("");
                        setTab("download");
                      }}
                    />
                  ) : <div className={styles.dataEmpty}>平台没有返回可展示的作品信息。</div>
                )}
              </section>
            ) : runDetails ? (
              <section className={styles.resultSection}>
                <header className={styles.sectionHeader}>
                  <h2>{skillRun.run?.skillTitle || "拆解任务"}</h2>
                </header>
                {runDetails}
              </section>
            ) : loading ? (
              <section className={styles.resultSection} aria-busy="true">
                <p className={styles.loadingNote} role="status">{kind === "account" ? "正在建立账号情报快照…" : "正在读取平台数据…"}</p>
                <ResultSkeleton />
              </section>
            ) : (
              <div className={styles.empty}>
                {kind === "account" ? <UserRoundSearch aria-hidden /> : <Film aria-hidden />}
                <strong>{kind === "account" ? "输入账号主页，建立情报快照" : "先还原事实，再解释方法"}</strong>
                <p>{kind === "account"
                  ? "先读取账号资料与近期公开作品，再生成样本排行、互动构成和可执行的内容策略。"
                  : "标题、作者、发布时间与互动指标直接来自平台，不由 AI 猜测；随后 AI 依据视频给出带时间码证据的拆解。"}</p>
              </div>
            )}
          </div>
        ) : (
          <div className={styles.panel} role="tabpanel" id="analysis-panel-download" aria-labelledby="analysis-tab-download">
            {/* 版式参考成熟下载站:居中窄栏 + 逐块堆叠,一次只回答一个问题——
                怎么用 → 贴链接 → 看画面 → 选格式下载 → 取元信息。画质不再在
                解析前猜,而是拿到真实结果后在格式面板里切换(见 formatSwitch)。 */}
            <div className={styles.downloadColumn}>
              <section className={styles.getter}>
                <p className={styles.getterSteps}>
                  <span>复制视频分享链接</span><i aria-hidden />
                  <span>粘贴到下方</span><i aria-hidden />
                  <span>点击解析视频</span>
                </p>
                <div className={styles.getterField} data-recognized={recognizedSource ? "true" : "false"}>
                  <span className={styles.getterMark} aria-hidden>
                    {recognizedSource ? <Check /> : <Link2 />}
                  </span>
                  <input
                    value={downloadSource}
                    onChange={(event) => { setDownloadSource(event.target.value); setDownloadResult(null); setDownloadError(""); }}
                    onKeyDown={(event) => { if (event.key === "Enter") void resolveVideoDownload(); }}
                    disabled={downloadBusy}
                    maxLength={4096}
                    placeholder={downloaderPlatforms.length > 0
                      ? `${downloaderPlatforms.map((platform) => DOWNLOAD_PLATFORM_LABEL[platform] || platform).join("、")}公开视频链接`
                      : "粘贴公开视频链接"}
                    autoComplete="off"
                    spellCheck={false}
                    aria-label="公开视频链接"
                  />
                  {!!url.trim() && url.trim() !== downloadSource.trim() && (
                    <button type="button" className={styles.getterBorrow} disabled={downloadBusy} onClick={() => { setDownloadSource(url.trim()); setDownloadResult(null); setDownloadError(""); }}>用拆解链接</button>
                  )}
                  {initialized && !user ? (
                    <Link className={styles.primaryButton} href="/login">登录后下载 <ChevronRight aria-hidden /></Link>
                  ) : (
                    <button className={styles.primaryButton} type="button" disabled={!downloadSource.trim() || !downloaderReady || downloadBusy} onClick={() => void resolveVideoDownload()}>
                      {downloadBusy ? <Loader2 className={styles.spin} aria-hidden /> : <ScanSearch aria-hidden />}
                      {downloadBusy ? "正在解析" : "解析视频"}
                    </button>
                  )}
                </div>
                <div className={styles.platformRow}>
                  <span className={styles.platformLead}>支持</span>
                  {downloaderPlatforms.length > 0
                    ? downloaderPlatforms.map((platform) => (
                      <span key={platform} className={styles.platformChip}>{DOWNLOAD_PLATFORM_LABEL[platform] || platform}</span>
                    ))
                    : <span className={styles.platformNote}>{downloaderStatusError ? "平台列表读取失败" : downloaderCapabilities ? "暂无已启用平台" : "正在读取已启用平台"}</span>}
                  <span className={styles.platformNote}>仅公开内容 · 单文件上限 {displayBytes(downloaderCapabilities?.maxFileBytes || 0)} · 下载票据有效 {displayTokenTTL(downloaderCapabilities?.tokenTtlSeconds || 0)}</span>
                </div>
                {user && downloaderCapabilities && !downloaderReady && (
                  <div className={styles.notice}><CircleAlert aria-hidden /> 视频下载服务当前未启用，请联系管理员检查 Relay API Key 与下载器开关。</div>
                )}
                {user && downloaderStatusError && (
                  <div className={styles.notice}><CircleAlert aria-hidden /> 暂时无法读取下载器能力，可点击右上角状态重新检查。</div>
                )}
                {downloadError && <div className={styles.error} role="alert"><CircleAlert aria-hidden /><span>{downloadError}</span></div>}
              </section>

              {downloadResult ? (
                <>
                  <section className={styles.posterCard}>
                    <DownloadPoster result={downloadResult} />
                  </section>

                  {/* 切换画质时结果原地更新,期间旧的下载地址仍在屏幕上——必须禁用
                      下载,否则点下去拿到的是上一档画质的文件。 */}
                  <section className={styles.formatCard} data-busy={downloadBusy ? "true" : "false"} aria-busy={downloadBusy}>
                    <h3><FileVideo aria-hidden /> MP4</h3>
                    <div className={styles.formatRow}>
                      <div className={styles.formatSpec}>
                        <b>
                          {DOWNLOAD_QUALITY.find((item) => item.key === downloadResult.quality)?.label || downloadResult.quality}
                          {downloadResult.height > 0 ? ` ${downloadResult.height}P` : ""}
                        </b>
                        <span className={styles.formatChips}>
                          <i>{displayDurationSeconds(downloadResult.durationSeconds)}</i>
                          <i>{displayBytes(downloadResult.estimatedBytes)}</i>
                          {downloadResult.width > 0 && downloadResult.height > 0 && <i>{downloadResult.width}×{downloadResult.height}</i>}
                        </span>
                      </div>
                      <button type="button" className={styles.primaryButton} disabled={downloadBusy} onClick={downloadResolvedVideo}>
                        {downloadBusy ? <Loader2 className={styles.spin} aria-hidden /> : <Download aria-hidden />}
                        {downloadBusy ? "正在换档" : "下载"}
                      </button>
                    </div>
                    <div className={styles.formatSwitch}>
                      <span>切换画质</span>
                      <div>
                        {DOWNLOAD_QUALITY.map((option) => (
                          <button
                            type="button"
                            key={option.key}
                            // 选中态取自实际解析结果,而不是 downloadQuality state:
                            // state 在解析前就已改变,若这次解析失败(结果原地保留),
                            // 开关会显示新画质而卡片仍是旧画质,自相矛盾。取结果值
                            // 则失败时自动回到真实状态。
                            aria-pressed={downloadResult.quality === option.key}
                            className={downloadResult.quality === option.key ? styles.formatSwitchActive : ""}
                            disabled={downloadBusy}
                            title={option.detail}
                            onClick={() => { setDownloadQuality(option.key); void resolveVideoDownload(option.key); }}
                          >{option.label}</button>
                        ))}
                      </div>
                      <small>临时地址在 {new Date(downloadResult.expiresAt * 1000).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} 前有效</small>
                    </div>
                  </section>

                  <section className={styles.infoCard}>
                    <InfoRow label="标题" value={downloadResult.title || "公开视频"} />
                    {!!downloadResult.coverUrl && <InfoRow label="封面" value={downloadResult.coverUrl} />}
                    <InfoRow label="文件名" value={downloadResult.fileName || "video.mp4"} />
                  </section>
                </>
              ) : downloadBusy ? (
                <section className={styles.posterCard} aria-busy="true">
                  <div className={`${styles.posterMedia} ${styles.posterLoading}`} />
                  <p className={styles.loadingNote} role="status">正在解析视频…</p>
                </section>
              ) : (
                <div className={styles.downloadPlaceholder}>
                  <span><Download aria-hidden /></span>
                  <strong>解析后在这里预览并下载</strong>
                  <p>先确认画面、分辨率与预计大小，再交给浏览器保存到默认目录。下载不消耗积分。</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
