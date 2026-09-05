"use client";

/* /analysis — 拆解工作台。

   两件事共用一个入口:「内容拆解」把公开链接还原成平台事实再交给 AI 拆方法,
   「视频下载」把公开视频取回本地；左侧栏集中回看当前账号的使用记录。
   两项操作各自依赖不同的后端服务(TikHub 解析 / 本站视频下载器),因此并列为
   顶层操作页签——一次只做一件事，历史快照在右侧原位复现。

   配色全部走 imini 主题 token(--bg/--surface/--border/--text/--accent),
   不再手抄十六进制:主题调整时本页跟随,不会落单。 */

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
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
  History,
  Link2,
  Lightbulb,
  Loader2,
  Pencil,
  RotateCcw,
  ScanSearch,
  ShieldCheck,
  Sparkles,
  Target,
  Trophy,
  UserRoundSearch,
  X,
} from "lucide-react";
import { fileApi } from "@/lib/api";
import { skillApi } from "@/lib/skill-api";
import {
  socialAnalysisApi,
  type SocialActivityRecordDetailVO,
  type SocialAnalysisKind,
  type SocialAnalysisStatusVO,
  type SocialInspectVO,
  type SocialPlatform,
  type SocialMetricVO,
  type SocialPlatformDetails,
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
import { skillRunError, type SkillRunAction, type SkillRunVO } from "@/types/skill-run";
import { FileCategory } from "@/types/file";
import type { SkillVO } from "@/types/skill";
import { toast } from "@/components/shared/toast";
import { buildAccountFeatures, buildAccountSnapshot, type AccountWorkDatum } from "./account-insights";
import { AccountVisuals } from "./account-visuals";
import { AccountReportMetrics } from "./account-report-metrics";
import { extractAccountReportBrief } from "./account-report-brief";
import { ContentAnalysisReport } from "./content-analysis-report";
import { CONTENT_REPORT_FORMAT } from "./content-report";
import { buildWorkSnapshot } from "./work-insights";
import { platformMetrics, platformVocabulary } from "./platform-metrics.js";
import { parseMetricNumber } from "./metric-number.js";
import { parsePublicationDate } from "./publication-date.js";
import { PlatformAccountPanels, PlatformWorkDetails } from "./platform-details";
import { ActivityHistorySidebar } from "./activity-history";
import { useLatestActivity } from "./use-latest-activity";
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
  douyin: "#00d4d8",
  pinterest: "#e60023",
  bilibili: "#00aeec",
  kuaishou: "#ff5000",
  tiktok: "#fe2c55",
  instagram: "#e1306c",
  youtube: "#ff0033",
};

const DOWNLOAD_PLATFORM_LABEL: Record<string, string> = {
  douyin: "抖音",
  pinterest: "Pinterest",
  bilibili: "哔哩哔哩",
  kuaishou: "快手",
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
};

const ACTIVITY_STATUS_LABEL: Record<string, string> = {
  processing: "处理中",
  ready: "待下载",
  downloading: "下载中",
  succeeded: "下载成功",
  failed: "失败",
  expired: "已过期",
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

function parsedDate(value?: string): Date | null {
  const parsed = parsePublicationDate(value);
  return parsed ? new Date(parsed.timestamp) : null;
}

function displayDate(value?: string): string {
  const date = parsedDate(value);
  return date
    ? new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short", day: "numeric", timeZone: parsePublicationDate(value)?.hasTime ? undefined : "UTC" }).format(date)
    : value || "";
}

function displaySnapshotTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value || "时间未知";
  return date.toLocaleString("zh-CN", { hour12: false });
}

function isSocialInspectSnapshot(value: unknown): value is SocialInspectVO {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const snapshot = value as Partial<SocialInspectVO>;
  return (snapshot.kind === "account" || snapshot.kind === "content") &&
    typeof snapshot.sourceUrl === "string" && !!snapshot.sourceUrl.trim() &&
    typeof snapshot.platform === "string" &&
    typeof snapshot.fetchedAt === "number" && Number.isFinite(snapshot.fetchedAt) &&
    Array.isArray(snapshot.works) && Array.isArray(snapshot.warnings);
}

function displayDateTime(value?: string): string {
  const date = parsedDate(value);
  if (!date) return value || "";
  if (!parsePublicationDate(value)?.hasTime) return displayDate(value);
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
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
  return work.mediaType?.toLowerCase().includes("video") === true || workVideoSources(work).length > 0;
}

function workVideoSources(work: SocialWorkVO): string[] {
  return [...new Set([work.mediaUrl ?? "", ...(work.mediaUrls ?? [])].map(value => value.trim()).filter(Boolean))].slice(0, 5);
}

function workImageSources(work: SocialWorkVO, limit = 9): string[] {
  const images = [...new Set((work.imageUrls ?? []).map((value) => value.trim()).filter(Boolean))].slice(0, limit);
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

function promptDetails(details?: SocialPlatformDetails, maxBytes = 2400): SocialPlatformDetails | undefined {
  if (!details) return undefined;
  const summary = {
    fields: details.fields?.slice(0, 12).map((field) => ({ ...field, value: field.value.slice(0, 160) })),
    tags: details.tags?.slice(0, 16).map((tag) => tag.slice(0, 80)),
    chapters: details.chapters?.slice(0, 12).map((chapter) => ({ ...chapter, title: chapter.title.slice(0, 120) })),
    languages: details.languages?.slice(0, 10),
  };
  // Keep valid JSON and whole metadata entries; this does not alter the snapshot.
  while (byteLength(JSON.stringify(summary)) > maxBytes) {
    if (summary.chapters?.length) summary.chapters.pop();
    else if (summary.fields?.length) summary.fields.pop();
    else if (summary.tags?.length) summary.tags.pop();
    else if (summary.languages?.length) summary.languages = summary.languages.slice(0, -1);
    else break;
  }
  return summary;
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
    details: promptDetails(result.profile.details),
  } : undefined;
  const recentWorks = result.works.map((work) => ({
    id: work.id,
    title: work.title?.slice(0, 120),
    description: work.description?.slice(0, 240),
    publishedAt: work.publishedAt,
    duration: work.duration,
    mediaType: work.mediaType,
    stats: work.stats,
    details: promptDetails(work.details),
  }));
  const sampleSummary = {
    sampleCount: snapshot.sampleCount,
    measuredViewSamples: snapshot.measuredViews,
    totalSampleViews: snapshot.totalViews,
    averageSampleViews: snapshot.averageViews,
    medianSampleViews: snapshot.medianViews,
    medianVisibleEngagementRate: snapshot.medianEngagementRate,
    highPerformanceSampleRate: snapshot.highPerformanceRate,
    highPerformanceDefinition: "play count >= 2 * sample median play count",
    topPerformanceMultiple: snapshot.topPerformanceMultiple,
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
    focus.trim().slice(0, 4000) || ACCOUNT_DEFAULT_FOCUS,
    "先面向普通创作者输出三个简短板块：## 一句话定位、## 值得借鉴、## 下一步建议。每个板块只写一句不超过 70 字的完整结论，不重复罗列统计数字。推测保留‘可能’等限定语，缺少依据时明确说明。之后以 ## 详细分析 展开依据和细节。不要编造分数、评级或平台未提供的数据。",
    "</user_request>",
    "<platform_data untrusted=\"true\">",
    JSON.stringify({ platform: result.platformName, sourceUrl: result.sourceUrl.slice(0, 1024), profile, sampleSummary, includedWorkCount: recentWorks.length, recentWorks }),
    "</platform_data>",
  ].join("\n");
  let prompt = render();
  // Compress optional metadata first so twelve samples do not silently become
  // one simply because the provider returned detailed chapters or long tags.
  if (byteLength(prompt) > 30 * 1024) {
    if (profile) profile.details = promptDetails(profile.details, 768);
    for (const work of recentWorks) work.details = promptDetails(work.details, 768);
    prompt = render();
  }
  if (byteLength(prompt) > 30 * 1024) {
    if (profile) profile.details = undefined;
    for (const work of recentWorks) { work.details = undefined; work.description = work.description?.slice(0, 80); }
    prompt = render();
  }
  // Last resort for unusually long identities/counters in a saved response.
  // Keep the full-cohort summary and state how many work details are included.
  while (byteLength(prompt) > 30 * 1024 && recentWorks.length > 1) {
    recentWorks.pop();
    prompt = render();
  }
  return prompt;
}

function contentPrompt(result: SocialInspectVO, work: SocialWorkVO, focus: string, videoWork: boolean): string {
  return [
    "<user_request>",
    focus.trim().slice(0, 4000) || (videoWork ? DEFAULT_FOCUS : IMAGE_DEFAULT_FOCUS),
    "</user_request>",
    "根据平台和作品类型分析。B 站关注投币、收藏、弹幕和分区；小红书区分图文与视频，关注收藏、话题与笔记内容；YouTube 关注频道、观看、字幕与章节；抖音/TikTok/快手关注短视频、音乐、话题和已返回的互动。只使用本次有值的字段，不把未返回数据当作 0，不推断未提供的粉丝画像。",
    videoWork ? CONTENT_REPORT_FORMAT : "先输出 ## 一句话看懂、## 视觉焦点、## 值得借鉴，每项一句不超过 70 字的完整结论，保留不确定性；随后用 ## 完整分析 给出依据与细节，不编造评分。",
    "<platform_data untrusted=\"true\">",
    JSON.stringify({
      platform: result.platformName,
      sourceUrl: (work.pageUrl || result.sourceUrl).slice(0, 1024),
      title: work.title?.slice(0, 300),
      description: work.description?.slice(0, 1000),
      publishedAt: work.publishedAt,
      duration: work.duration,
      mediaType: work.mediaType,
      stats: work.stats,
      details: promptDetails(work.details),
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

function analysisRunMode(input: unknown): "account" | "image" | "video" | "" {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "";
  const parameters = (input as { parameters?: unknown }).parameters;
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) return "";
  const value = (parameters as { analysisMode?: unknown }).analysisMode;
  return value === "account" || value === "image" || value === "video" ? value : "";
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

function accountReportText(run: SkillRunVO): string {
  const artifacts = [...(run.artifacts ?? []), ...(run.steps ?? []).flatMap((step) => step.artifacts ?? [])];
  const final = artifacts.find((artifact) => artifact.isFinal && (artifact.text?.trim() || artifact.content?.trim()));
  const fallback = [...artifacts].reverse().find((artifact) => artifact.text?.trim() || artifact.content?.trim());
  return final?.text?.trim() || final?.content?.trim() || fallback?.text?.trim() || fallback?.content?.trim() || "";
}

interface AccountStrategyReportProps {
  run: SkillRunVO;
  busy: boolean;
  onAction: (action: SkillRunAction) => void | Promise<unknown>;
  onReEdit: () => void | Promise<unknown>;
  onDismiss: () => void;
}

function AccountStrategyReport({ run, busy, onAction, onReEdit, onDismiss }: AccountStrategyReportProps) {
  const [expanded, setExpanded] = useState(false);
  const active = run.status === "queued" || run.status === "running";
  const succeeded = run.status === "succeeded";
  const failed = run.status === "failed";
  const progress = Math.max(0, Math.min(100, Number.isFinite(run.progress) ? run.progress : 0));
  const text = accountReportText(run);
  const brief = useMemo(() => extractAccountReportBrief(text), [text]);
  const reportTime = run.completeTime || run.updateTime || run.createTime || "";

  return (
    <article className={styles.accountReport} data-status={run.status} aria-live="polite">
      <header className={styles.accountReportHeader}>
        <div><h3>账号策略报告</h3><small>根据本次公开样本生成</small></div>
        <span>{active ? `正在生成 · ${Math.round(progress)}%` : succeeded ? "已生成" : failed ? "生成失败" : "已停止"}</span>
      </header>

      {active ? (
        <div className={styles.accountReportPending}>
          <Loader2 className={styles.spin} aria-hidden />
          <div><strong>正在整理账号洞察</strong><p>AI 正在对照账号资料和近期作品，报告完成后会直接显示在这里。</p></div>
          <div className={styles.accountReportProgress} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress)}><i style={{ transform: `scaleX(${Math.max(.02, progress / 100)})` }} /></div>
        </div>
      ) : succeeded ? (
        <div className={styles.accountBriefContent}>
          {brief.length > 0 && <div className={styles.reportTakeaways}>{brief.map((item) => {
            const Icon = item.key === "position" ? Target : item.key === "strength" ? Trophy : Lightbulb;
            return <section key={item.key} data-kind={item.key}><span><Icon aria-hidden /></span><div><h4>{item.label}</h4><p>{item.text}</p></div></section>;
          })}</div>}
          {text ? <details className={styles.reportFullDetails} onToggle={(event) => setExpanded(event.currentTarget.open)}>
            <summary>{brief.length ? "查看完整分析与依据" : "展开完整报告"}<ChevronRight aria-hidden /></summary>
            {expanded && <div className={styles.accountReportContent}>{renderAnalysisMarkdown(text)}</div>}
          </details> : <p className={styles.accountReportEmpty}>报告已经完成，但暂时没有可展示的正文。</p>}
        </div>
      ) : (
        <div className={styles.accountReportFailure}>
          <CircleAlert aria-hidden />
          <div><strong>{failed ? "这次报告没有生成成功" : "报告生成已停止"}</strong><p>{failed ? skillRunError(run) || "服务暂时不可用，请稍后重试。" : "你可以重新运行这次账号策略分析。"}</p></div>
        </div>
      )}

      <div className={styles.accountReportFooter}>
        <span>{reportTime ? `${succeeded ? "生成于" : "开始于"} ${displaySnapshotTime(reportTime)}` : ""}{run.pointCost && run.pointCost > 0 ? ` · 使用 ${run.pointCost} 积分` : ""}</span>
        <div>
          {active ? <button type="button" disabled={busy} onClick={() => void onAction("cancel")}>停止生成</button> : null}
          {failed || run.status === "cancelled" ? <button type="button" disabled={busy} onClick={() => void onAction("retry")}><RotateCcw aria-hidden />重新生成</button> : null}
          {succeeded ? <button type="button" disabled={busy} onClick={() => void onReEdit()}><Pencil aria-hidden />重新编辑</button> : null}
          {!active ? <button type="button" disabled={busy} onClick={onDismiss}>关闭报告</button> : null}
        </div>
      </div>
    </article>
  );
}

/* 视频预览使用独立媒体地址，不触发附件下载或创建下载记录。 */
function DownloadPoster({ result, onDuration, onRefresh, refreshing }: {
  result: VideoDownloadResolveVO;
  onDuration: (seconds: number) => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const cover = failed ? "" : result.coverUrl?.trim() || "";
  const preview = previewError ? "" : result.previewUrl?.trim() || "";
  const tint = DOWNLOAD_PLATFORM_COLOR[result.platform] || "#8b8b93";
  const platformLabel = DOWNLOAD_PLATFORM_LABEL[result.platform] || result.platform;
  const qualityLabel = DOWNLOAD_QUALITY.find((item) => item.key === result.quality)?.label || result.quality;
  return (
    <div className={styles.posterMedia} style={{ "--platform": tint } as React.CSSProperties}>
      {preview ? (
        <video
          src={apiUrl(preview)}
          poster={cover || undefined}
          controls
          controlsList="nodownload"
          playsInline
          preload="metadata"
          aria-label={`${result.title || "视频"}预览`}
          onLoadedMetadata={(event) => {
            const seconds = event.currentTarget.duration;
            if (Number.isFinite(seconds) && seconds > 0) onDuration(Math.round(seconds));
          }}
          onError={() => setPreviewError(result.expiresAt * 1000 <= Date.now() ? "预览地址已过期，请重新获取视频" : "暂时无法预览，可下载后播放")}
        />
      ) : cover ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={cover} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
      ) : (
        <span className={styles.posterFallback}><Film aria-hidden /><span>暂时无法预览画面</span>{!previewError && <small>可以使用下方下载按钮保存后播放</small>}</span>
      )}
      {previewError && <div className={styles.previewNotice} role="status">
        <span>{previewError}</span>
        <button type="button" disabled={refreshing} onClick={() => {
          if (result.expiresAt * 1000 <= Date.now()) onRefresh();
          else setPreviewError("");
        }}><RotateCcw aria-hidden />重试预览</button>
      </div>}
      <span className={`${styles.posterChip} ${styles.posterChipPlatform}`}>{platformLabel}</span>
      <span className={`${styles.posterChip} ${styles.posterChipQuality}`}>{qualityLabel}</span>
      {!preview && result.durationSeconds > 0 && (
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

function AccountSampleTrend({ works, medianViews: sampleMedian, platform, onInspect }: { works: AccountWorkDatum[]; medianViews: number | null; platform: SocialPlatform; onInspect: (item: AccountWorkDatum) => void }) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [logScale, setLogScale] = useState(false);
  const [metricKey, setMetricKey] = useState<keyof SocialMetricVO | null>(null);
  const choices = platformMetrics(platform).filter((metric) => works.filter((item) => item.publishedAtMs !== null && parseMetricNumber(item.work.stats[metric.key]) !== null).length >= 2);
  const metric = choices.find((item) => item.key === metricKey) || choices[0];
  const points = works.map((item) => ({ ...item, metricValue: metric ? parseMetricNumber(item.work.stats[metric.key]) : null })).filter((item) => item.publishedAtMs !== null && item.metricValue !== null).sort((a, b) => a.publishedAtMs! - b.publishedAtMs!);
  if (!metric || points.length < 2) return <section className={styles.sampleTrend}><header className={styles.sectionHeader}><div><h2>近期作品表现</h2><p>按发布时间对照本平台已返回的指标。</p></div></header><p className={styles.visualEmpty}>至少需要两条同时包含同一指标和发布时间的作品，才能展示分布曲线。已有作品仍可在下方查看。</p></section>;
  const sortedValues = points.map((item) => item.metricValue!).sort((a, b) => a - b);
  const middle = Math.floor(sortedValues.length / 2);
  const medianViews = metric.key === "play" ? sampleMedian : sortedValues.length % 2 ? sortedValues[middle] : (sortedValues[middle - 1] + sortedValues[middle]) / 2;
  const width = 1000, height = 220, left = 16, right = 16, top = 16, bottom = 28;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const minTime = points[0].publishedAtMs!, maxTime = points.at(-1)!.publishedAtMs!;
  const peakViews = Math.max(0, ...points.map((item) => item.metricValue!));
  const maxViews = Math.max(1, peakViews);
  const selected = points.find((item) => item.index === selectedIndex) ?? points.reduce((best, item) => item.metricValue! > best.metricValue! ? item : best);
  const x = (time: number, index: number) => left + (maxTime === minTime ? index / (points.length - 1) : (time - minTime) / (maxTime - minTime)) * plotWidth;
  const y = (views: number) => top + plotHeight - (logScale ? Math.log1p(views) / Math.log1p(maxViews) : views / maxViews) * plotHeight;
  const coordinates = points.map((item, index) => ({ x: x(item.publishedAtMs!, index), y: y(item.metricValue!) }));
  const line = coordinates.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const area = `${left},${top + plotHeight} ${line} ${coordinates.at(-1)!.x},${top + plotHeight}`;
  const medianY = medianViews !== null && medianViews <= maxViews ? y(medianViews) : null;
  return (
    <section className={styles.sampleTrend}>
      <header className={styles.sectionHeader}>
        <div><h2>近期作品表现</h2><p>按作品发布时间观察{metric.label}分布，不等同于账号历史增长。</p></div>
        <div className={styles.trendScale} role="group" aria-label="指标与刻度"><select aria-label="图表指标" value={metric.key} onChange={(event) => setMetricKey(event.target.value as keyof SocialMetricVO)}>{choices.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select><button type="button" aria-pressed={!logScale} onClick={() => setLogScale(false)}>原始数值</button><button type="button" aria-pressed={logScale} onClick={() => setLogScale(true)}>对数刻度</button></div>
      </header>
      <div className={styles.trendReadout}>
        <div><small>{points.length} 条有效样本 · 峰值 {displayCompactMetric(peakViews)}</small><strong>{displayCompactMetric(selected.metricValue)}<span> 次{metric.label}</span></strong></div>
        <button type="button" onClick={() => onInspect(selected)}><span>{titleOf(selected.work)}</span><small>{displayDateTime(selected.work.publishedAt)} · 查看作品 <ArrowUpRight aria-hidden /></small></button>
      </div>
      <div className={styles.trendCanvas}>
        <div className={styles.trendYAxis} aria-hidden>{[1, .75, .5, .25, 0].map((ratio) => <span key={ratio}>{displayCompactMetric(logScale ? Math.expm1(Math.log1p(maxViews) * ratio) : maxViews * ratio)}</span>)}</div>
        <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="group" aria-label={`近期作品${metric.label}分布，点选节点查看作品`}>
          <title>近期作品{metric.label}分布</title>
          {[0, .25, .5, .75, 1].map((ratio) => <line key={ratio} className={styles.trendGridLine} x1={left} x2={width - right} y1={top + plotHeight * ratio} y2={top + plotHeight * ratio} />)}
          <polygon className={styles.trendArea} points={area} />
          {medianY !== null && <line className={styles.trendMedian} x1={left} x2={width - right} y1={medianY} y2={medianY} />}
          <polyline className={styles.trendLine} points={line} />
          {coordinates.map((point, index) => <g key={points[index].index}>
            {selected.index === points[index].index && <line className={styles.trendCursor} x1={point.x} x2={point.x} y1={top} y2={top + plotHeight} />}
            <circle className={styles.trendPoint} data-active={selected.index === points[index].index} cx={point.x} cy={point.y} r={selected.index === points[index].index ? 6 : 4} />
            <circle className={styles.trendHit} cx={point.x} cy={point.y} r="16" tabIndex={0} role="button" aria-label={`${titleOf(points[index].work)}，${displayCompactMetric(points[index].metricValue)} 次${metric.label}，查看详情`} onMouseEnter={() => setSelectedIndex(points[index].index)} onFocus={() => setSelectedIndex(points[index].index)} onClick={() => { setSelectedIndex(points[index].index); onInspect(points[index]); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onInspect(points[index]); } }} />
          </g>)}
        </svg>
        <div className={styles.trendAxis}>
          <span>{displayDate(points[0].work.publishedAt)}</span>
          {medianViews !== null && <span>中位{metric.label} {displayCompactMetric(medianViews)}</span>}
          <span>{displayDate(points.at(-1)?.work.publishedAt)}</span>
        </div>
      </div>
      <p className={styles.visualNote}>{logScale ? `对数刻度压缩高${metric.label}峰值，节点仍显示实际次数。` : `悬停或聚焦节点查看${metric.label}数据，点击打开作品。峰值差距大时可切换对数刻度。`}</p>
    </section>
  );
}

function AccountWorkInspector({
  item,
  platform,
  medianViews,
  canDownload,
  onDownload,
  onClose,
}: {
  item: AccountWorkDatum | null;
  platform: SocialPlatform;
  medianViews: number | null;
  canDownload: boolean;
  onDownload: () => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (item && !dialog.open) dialog.showModal();
    if (!item && dialog.open) dialog.close();
  }, [item]);
  const relative = item && item.views !== null && medianViews && medianViews > 0 ? item.views / medianViews : null;
  return (
    <dialog
      ref={dialogRef}
      className={styles.workInspector}
      aria-labelledby="account-work-inspector-title"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      {item && (
        <div className={styles.workInspectorPanel}>
          <header><div><strong id="account-work-inspector-title">作品详情</strong><small>公开数据快照</small></div><button type="button" onClick={onClose} aria-label="关闭作品详情"><X aria-hidden /></button></header>
          <div className={styles.workInspectorMedia}><WorkCover work={item.work} platform={platform} alt={`作品封面：${titleOf(item.work)}`} /></div>
          <div className={styles.workInspectorCopy}><h3>{titleOf(item.work)}</h3><time>{displayDateTime(item.work.publishedAt) || "发布时间未知"}</time></div>
          <div className={styles.workInspectorMetrics}>
            {platformMetrics(platform).filter((metric) => parseMetricNumber(item.work.stats[metric.key]) !== null).map((metric) => <div key={metric.key}><small>{metric.label}</small><strong>{displayCount(item.work.stats[metric.key])}</strong></div>)}
            <div><small>可见互动</small><strong>{displayCompactMetric(item.hasInteractionData ? item.interactions : null)}</strong></div>
            <div><small>可见互动率</small><strong>{displayPercent(item.engagementRate)}</strong></div>
            <div><small>相对中位播放</small><strong>{relative === null ? "—" : `${relative.toFixed(2)}×`}</strong></div>
          </div>
          <div className={styles.workInspectorSignal} data-level={relative !== null && relative >= 2 ? "high" : relative !== null && relative < .6 ? "low" : "normal"}>
            <strong>{relative === null ? "表现基准暂不可用" : relative >= 2 ? "显著高于账号样本基准" : relative < .6 ? "低于账号样本基准" : "接近账号样本基准"}</strong>
            <p>{relative === null ? "需要至少两个具备播放数据的作品才能形成可靠中位基准。" : `该作品播放量约为账号样本中位数的 ${relative.toFixed(2)} 倍。这里只描述相关数据，不推断因果。`}</p>
          </div>
          <div className={styles.workInspectorActions}>
            {item.work.pageUrl && <a href={item.work.pageUrl} target="_blank" rel="noopener noreferrer">查看原作品 <ArrowUpRight aria-hidden /></a>}
            {canDownload && <button type="button" onClick={onDownload}><Download aria-hidden /> 下载原片</button>}
          </div>
          <PlatformWorkDetails work={{ ...item.work, platform }} />
        </div>
      )}
    </dialog>
  );
}

interface AccountDashboardProps {
  result: SocialInspectVO;
  focus: string;
  busy: boolean;
  runDetails: React.ReactNode;
  skillError: string;
  historical: boolean;
  hasSavedReport: boolean;
  downloaderPlatforms: string[];
  onRun: () => void;
  onDownloadWork: (work: SocialWorkVO) => void;
}

function AccountDashboard({
  result,
  focus,
  busy,
  runDetails,
  skillError,
  historical,
  hasSavedReport,
  downloaderPlatforms,
  onRun,
  onDownloadWork,
}: AccountDashboardProps) {
  const [inspectedWork, setInspectedWork] = useState<AccountWorkDatum | null>(null);
  const [workOrder, setWorkOrder] = useState<"recent" | "views" | "interactions">("recent");
  const [highOnly, setHighOnly] = useState(false);
  const snapshot = buildAccountSnapshot(result);
  const features = buildAccountFeatures(snapshot);
  const meta = platformMeta(result.platform);
  const profile = result.profile;
  const filteredWorks = snapshot.works
    .filter((item) => !highOnly || !features.comparable || (item.views !== null && item.views >= snapshot.medianViews! * 2))
    .sort((a, b) => {
      if (workOrder === "views") return (b.views ?? -1) - (a.views ?? -1) || a.index - b.index;
      if (workOrder === "interactions") return (b.hasInteractionData ? b.interactions : -1) - (a.hasInteractionData ? a.interactions : -1) || a.index - b.index;
      return (b.publishedAtMs ?? 0) - (a.publishedAtMs ?? 0) || a.index - b.index;
    });
  const publishedRange = snapshot.firstPublishedAt !== null && snapshot.lastPublishedAt !== null
    ? `${displayDate(snapshot.works.find((item) => item.publishedAtMs === snapshot.firstPublishedAt)?.work.publishedAt)} — ${displayDate(snapshot.works.find((item) => item.publishedAtMs === snapshot.lastPublishedAt)?.work.publishedAt)}`
    : "发布时间不完整";
  const fetchedLabel = result.fetchedAt > 0
    ? `抓取于 ${new Intl.DateTimeFormat("zh-CN", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(result.fetchedAt))}`
    : "本次查询";
  const profileFacts = [
    profile?.following ? `${displayCount(profile.following)} 关注` : "",
    profile?.likes ? `${displayCount(profile.likes)} 获赞` : "",
    profile?.works ? `${displayCount(profile.works)} ${platformVocabulary(result.platform).works}` : "",
  ].filter(Boolean);
  const kpis = [
    profile?.followers ? { label: platformVocabulary(result.platform).followers, value: displayCount(profile.followers), note: "平台累计" } : null,
    snapshot.medianViews !== null ? { label: "中位播放", value: displayCompactMetric(snapshot.medianViews), note: `${snapshot.measuredViews} 个有效样本` } : null,
    snapshot.highPerformanceRate !== null ? { label: "高表现样本率", value: displayPercent(snapshot.highPerformanceRate), note: "播放 ≥ 2× 中位数" } : null,
    snapshot.topPerformanceMultiple !== null ? { label: "最高样本倍数", value: `${snapshot.topPerformanceMultiple.toFixed(2)}×`, note: "相对中位播放" } : null,
    { label: "分析样本", value: String(snapshot.sampleCount), note: "近期公开作品" },
  ].filter((item): item is { label: string; value: string; note: string } => item !== null).slice(0, 5);
  const metricColumns = platformMetrics(result.platform).filter((metric) => result.works.some((work) => parseMetricNumber(work.stats[metric.key]) !== null));

  return (
    <div className={styles.accountDashboard} style={{ "--platform": meta.color } as React.CSSProperties}>
      <div className={styles.accountOverview}>
      <header className={styles.accountHero}>
        <div className={styles.accountIdentity}>
          <span className={styles.accountAvatar}><ProfileAvatar url={profile?.avatarUrl} platform={result.platform} /></span>
          <div className={styles.accountIdentityText}>
            <div className={styles.accountMetaLine}>
              <span><PlatformMark platform={result.platform} small />{result.platformName}</span>
              {profile?.handle && <code title={profile.handle}>{profile.handle}</code>}
            </div>
            <h2>{profile?.name || profile?.handle || (profile?.id ? `账号 ${profile.id}` : "未命名账号")}</h2>
            {profileFacts.length > 0 && <div className={styles.accountSummaryLine}>{profileFacts.join(" · ")}</div>}
            {profile?.bio && <p title={profile.bio}>{profile.bio}</p>}
          </div>
        </div>
        <div className={styles.accountHeroActions}>
          <span>{fetchedLabel}</span>
          <a href={profile?.pageUrl || result.sourceUrl} target="_blank" rel="noopener noreferrer">查看账号主页 <ArrowUpRight aria-hidden /></a>
        </div>

        <div className={styles.accountKpiRail} role="list" aria-label="账号关键指标">
          {kpis.map((item) => {
            const Icon = item.label === "粉丝" ? UserRoundSearch : item.label === "中位播放" ? BarChart3 : item.label === "高表现样本率" ? Target : item.label === "最高样本倍数" ? Trophy : Film;
            return <div role="listitem" key={item.label}><small><Icon aria-hidden />{item.label}</small><strong>{item.value}</strong><span>{item.note}</span></div>;
          })}
        </div>
      </header>

      {!!result.warnings?.length && (
        <div className={styles.warningList} role="status">
          {result.warnings.map((warning) => (
            <div className={styles.notice} key={warning}><CircleAlert aria-hidden /> {warning}</div>
          ))}
        </div>
      )}
      </div>
      <div className={styles.accountData}>
      <PlatformAccountPanels result={result} />
      <AccountSampleTrend works={snapshot.works} platform={result.platform} medianViews={snapshot.medianViews} onInspect={setInspectedWork} />

      <AccountVisuals snapshot={snapshot} onInspect={setInspectedWork} renderCover={(item) => <WorkCover work={item.work} platform={result.platform} />} />

      <section className={styles.accountWorksTable}>
        <header className={styles.sectionHeader}>
          <div><h2>近期作品</h2><p>对照播放、可见互动和相对表现，点击作品查看详情。</p></div>
          <span>{snapshot.sampleCount} 个样本 · {publishedRange}</span>
        </header>
        {snapshot.works.length > 0 && (
          <div className={styles.accountTableTools}>
            <div role="group" aria-label="作品筛选">
              <button type="button" aria-pressed={!highOnly || !features.comparable} onClick={() => setHighOnly(false)}>全部作品</button>
              <button type="button" aria-pressed={highOnly && features.comparable} disabled={!features.comparable} onClick={() => setHighOnly(true)}>高表现作品 {features.comparable ? features.bands[0].count : ""}</button>
            </div>
            <label>排序<select aria-label="作品排序" value={workOrder} onChange={(event) => setWorkOrder(event.target.value as typeof workOrder)}><option value="recent">最近发布</option><option value="views">播放优先</option><option value="interactions">互动优先</option></select></label>
          </div>
        )}
        {snapshot.works.length > 0 ? (
          <div className={styles.accountTableWrap}>
            <table>
              <thead><tr><th>{platformVocabulary(result.platform).works}</th><th>类型</th><th>发布时间</th>{metricColumns.map((metric) => <th key={metric.key}>{metric.label}</th>)}{snapshot.measuredViews > 0 && <th>可见互动率</th>}{snapshot.measuredViews > 1 && <th>相对播放</th>}</tr></thead>
              <tbody>
                {filteredWorks.map((item) => {
                  const multiple = snapshot.measuredViews > 1 && item.views !== null && snapshot.medianViews && snapshot.medianViews > 0 ? item.views / snapshot.medianViews : null;
                  return (
                    <tr key={item.work.id || `${item.work.pageUrl}-${item.index}`} data-clickable onClick={() => setInspectedWork(item)}>
                      <td><button type="button" className={styles.accountWorkTitle} onClick={() => setInspectedWork(item)} title={titleOf(item.work)}><span><WorkCover work={item.work} platform={result.platform} /></span><b>{titleOf(item.work)}</b></button></td>
                      <td>{item.work.mediaType === "image" ? "图文" : item.work.mediaType === "video" ? "视频" : "—"}</td>
                      <td>{displayDateTime(item.work.publishedAt) || "—"}</td>
                      {metricColumns.map((metric) => <td key={metric.key}>{displayCompactMetric(parseMetricNumber(item.work.stats[metric.key]))}</td>)}
                      {snapshot.measuredViews > 0 && <td>{displayPercent(item.engagementRate)}</td>}
                      {snapshot.measuredViews > 1 && <td><span className={styles.relativePerformance} data-level={multiple !== null && multiple >= 2 ? "high" : multiple !== null && multiple < .6 ? "low" : "normal"}>{multiple === null ? "—" : `${multiple >= 2 ? "高于日常 · " : ""}${multiple.toFixed(2)}×`}</span></td>}
                    </tr>
                  );
                })}
                {filteredWorks.length === 0 && <tr><td colSpan={3 + metricColumns.length + Number(snapshot.measuredViews > 0) + Number(snapshot.measuredViews > 1)}><p className={styles.inlineEmpty}>本次样本暂没有达到中位播放两倍的作品。</p></td></tr>}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={styles.inlineEmpty}>平台返回了账号资料，但没有可展示的公开作品。</p>
        )}
      </section>

      <p className={styles.scopeNote}>这是当前抓取样本的横截面，不代表粉丝增长趋势或行业基准。可见互动仅汇总已返回的指标，缺失数据以“—”展示。</p>
      </div>

      <aside className={`${styles.accountStrategy} ${styles.accountSummaryRail}`} aria-label="账号策略速览">
        <header className={styles.reportRailHeader}>
          <div><Sparkles aria-hidden /><h2>账号策略速览</h2></div>
          <span>{historical ? "历史快照" : "本次分析"}</span>
        </header>
        <AccountReportMetrics snapshot={snapshot} />
        <div className={styles.reportRailBody}>
          {skillError && <div className={styles.error} role="alert"><CircleAlert aria-hidden /><span>{skillError}</span></div>}
          {skillError && <button type="button" className={styles.primaryButton} disabled={busy} onClick={onRun}>{busy ? "正在重新启动" : "重新生成账号策略"}</button>}
          {runDetails || (!skillError && (
            <div className={styles.reportWaiting} role="status" aria-live="polite">
              {busy ? <Loader2 className={styles.spin} aria-hidden /> : <Sparkles aria-hidden />}
              <div><strong>{busy ? historical ? "正在读取当时的策略报告" : "正在自动生成账号策略" : historical && !hasSavedReport ? "这条记录未保存 AI 报告" : "当前未展示策略报告"}</strong>
                <p>{busy ? historical ? "正在恢复已保存的报告，不会重新调用平台或扣费。" : "无需再次点击，完成后会在这里展示简短结论。" : historical && !hasSavedReport ? "上方指标来自当时样本。查看历史不会重新调用或扣费。" : "可从左侧历史记录重新打开已保存的报告。"}</p></div>
            </div>
          ))}
          <details className={styles.accountAnalysisScope}><summary>本次分析范围</summary><p>{focus}</p></details>
        </div>
      </aside>

      <AccountWorkInspector
        item={inspectedWork}
        platform={result.platform}
        medianViews={snapshot.measuredViews > 1 ? snapshot.medianViews : null}
        canDownload={!!inspectedWork?.work.pageUrl && !!inspectedWork && isVideoWork(inspectedWork.work) && downloaderPlatforms.includes(result.platform)}
        onDownload={() => { if (inspectedWork) onDownloadWork(inspectedWork.work); }}
        onClose={() => setInspectedWork(null)}
      />
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
  historical: boolean;
  hasSavedReport: boolean;
  editingFocus: boolean;
  onRefresh: () => void;
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
  historical,
  hasSavedReport,
  editingFocus,
  onRefresh,
  onFocusChange,
  onRun,
  onDownload,
}: ContentDashboardProps) {
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const snapshot = buildWorkSnapshot(work, result.platform);
  const workMetrics = platformMetrics(result.platform).filter((metric) => parseMetricNumber(work.stats[metric.key]) !== null);
  const meta = platformMeta(result.platform);
  const interactionTotal = snapshot.interactions ?? 0;
  const author = result.profile;
  const videoWork = isVideoWork(work);
  const imageURLs = videoWork ? [] : workImageSources(work, 40);
  const mediaLabel = work.mediaType === "image" || imageURLs.length > 0 ? "图文作品" : videoWork ? "视频作品" : "公开作品";
  const selectedImageURL = imageURLs[Math.min(selectedImageIndex, Math.max(0, imageURLs.length - 1))] || work.coverUrl;
  const analysisAssetAvailable = videoWork ? workVideoSources(work).length > 0 : imageURLs.length > 0;
  const sourceURL = work.pageUrl || result.sourceUrl;
  const focusDetailsRef = useRef<HTMLDetailsElement>(null);
  const focusInputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editingFocus || runDetails || !focusDetailsRef.current) return;
    focusDetailsRef.current.open = true;
    focusInputRef.current?.focus();
    focusDetailsRef.current.scrollIntoView({ block: "nearest" });
  }, [editingFocus, runDetails]);

  return (
    <div className={styles.contentDashboard} style={{ "--platform": meta.color } as React.CSSProperties}>
      <div className={styles.contentOverview}>
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
            <span><CalendarDays aria-hidden />{displayDateTime(work.publishedAt) || "发布时间未知"}</span>
            <span>{videoWork ? <FileVideo aria-hidden /> : <Film aria-hidden />}{videoWork ? work.duration || "时长未知" : imageURLs.length ? `${imageURLs.length} 张图片` : "图片未返回"}</span>
            <span><Activity aria-hidden />{workMetrics.length} 项公开指标已获取</span>
          </div>
          <div className={styles.contentActions}>
            <a href={sourceURL} target="_blank" rel="noopener noreferrer">查看原作品 <ArrowUpRight aria-hidden /></a>
            {canDownload && <button type="button" onClick={onDownload}><Download aria-hidden /> 下载原片</button>}
          </div>
        </div>
        <div className={styles.contentKpiRail} role="list" aria-label="作品关键指标">
          {workMetrics.map((item) => (
            <div role="listitem" key={item.key}><small>{item.label}</small><strong>{displayCount(work.stats[item.key])}</strong></div>
          ))}
          {snapshot.engagementRate !== null && <div role="listitem"><small>可见互动率</small><strong>{displayPercent(snapshot.engagementRate)}</strong></div>}
          {workMetrics.length === 0 && <div role="listitem"><small>公开指标</small><strong>暂未返回</strong></div>}
        </div>
      </header>

      {!!result.warnings?.length && (
        <div className={styles.warningList} role="status">
          {result.warnings.map((warning) => (
            <div className={styles.notice} key={warning}><CircleAlert aria-hidden /> {warning}</div>
          ))}
        </div>
      )}
      </div>
      <div className={styles.contentData}>
      <PlatformWorkDetails work={{ ...work, platform: result.platform }} />
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
                {snapshot.interactionParts.filter((item) => item.value !== null).map((item) => (
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
          <p>可见互动汇总本平台已返回的{snapshot.interactionParts.map((item) => item.label).join("、")}；有播放量时才计算互动率。缺失字段不按 0 处理，次数不代表独立人数。</p>
        </section>
      </div>
      </div>

      <aside className={`${styles.contentStrategy} ${styles.contentReportRail}`} aria-label={videoWork ? "视频分析报告" : "图文分析报告"}>
        <header className={styles.reportRailHeader}>
          <div><Sparkles aria-hidden /><h2>{videoWork ? "视频拆解速览" : "图文拆解速览"}</h2></div>
          <span>{historical ? "历史快照" : "本次分析"}</span>
        </header>
        <div className={styles.contentReportBody}>
          {skillError && <div className={styles.error} role="alert"><CircleAlert aria-hidden /><span>{skillError}</span></div>}
          {runDetails || <>
            <div className={styles.contentReportIntro} role="status">
              <span>{busy ? <Loader2 className={styles.spin} aria-hidden /> : !analysisAssetAvailable ? videoWork ? <FileVideo aria-hidden /> : <Film aria-hidden /> : <ScanSearch aria-hidden />}</span>
              <h3>{busy ? historical ? "正在读取历史报告" : "正在准备分析素材" : editingFocus ? "调整重点，再生成一份报告" : historical && hasSavedReport ? "当前未展示拆解报告" : !analysisAssetAvailable ? videoWork ? "暂时没有可分析的视频素材" : "暂时没有可分析的图片" : videoWork ? "看懂内容，也看懂方法" : "看懂画面，也找到创作思路"}</h3>
              <p>{busy ? "结果会直接出现在这里，请稍候。" : editingFocus ? "已保留这次作品数据和上次分析重点。修改后点击重新生成，才会开始新的分析。" : historical && hasSavedReport ? "重新点击左侧记录即可恢复已保存的报告，不会重复扣费。" : !analysisAssetAvailable ? "本次平台仅返回了作品信息。上方数据可以查看，深度分析需要可读取的原始素材。" : videoWork ? "提炼视频主题、开场抓手与可借鉴方法，用时间片段回看关键发现。" : "提炼画面主题、视觉焦点与可借鉴方法，完整依据可随时展开。"}</p>
            </div>
            <div className={styles.contentReportTopics} aria-label="分析内容">
              <span><Target aria-hidden />{videoWork ? "开场抓手" : "视觉焦点"}</span>
              <span><Clock3 aria-hidden />{videoWork ? "节奏时间线" : "构图层级"}</span>
              <span><Lightbulb aria-hidden />创作启发</span>
            </div>
            {analysisAssetAvailable ? <button type="button" className={styles.primaryButton} disabled={busy} onClick={onRun}>
              {busy ? <Loader2 className={styles.spin} aria-hidden /> : <Sparkles aria-hidden />}
              {busy ? "正在准备报告" : editingFocus || (historical && hasSavedReport) ? "重新生成报告" : videoWork ? "开始视频拆解" : "开始图文拆解"}
            </button> : <button type="button" className={styles.primaryButton} disabled={busy} onClick={onRefresh}><RotateCcw aria-hidden />重新获取素材信息</button>}
            {analysisAssetAvailable && <p className={styles.reportNoTimeline}>生成报告按现有技能规则消耗积分，查看已保存的报告不重复扣费。</p>}
          </>}
          {!runDetails && analysisAssetAvailable && <details ref={focusDetailsRef} className={styles.contentFocusDetails}>
            <summary>调整分析重点<ChevronRight aria-hidden /></summary>
            <label className={styles.focusField}><span>你希望重点分析什么</span><textarea ref={focusInputRef} rows={4} value={focus} disabled={busy} onChange={event => onFocusChange(event.target.value)} maxLength={4000} /><small>{focus.length} / 4000</small></label>
          </details>}
        </div>
      </aside>
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
  const [editingContentFocus, setEditingContentFocus] = useState(false);
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
  const [strategyError, setStrategyError] = useState("");
  const [historicalRecord, setHistoricalRecord] = useState<SocialActivityRecordDetailVO | null>(null);
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [watchedDownloadRecordId, setWatchedDownloadRecordId] = useState("");
  const videoSkillRef = useRef<SkillVO | null>(null);
  const imageSkillRef = useRef<SkillVO | null>(null);
  const accountSkillRef = useRef<SkillVO | null>(null);
  const inspectBusyRef = useRef(false);
  const analysisBusyRef = useRef(false);
  const runActionRef = useRef<{ runId: string } | null>(null);
  const inspectEpochRef = useRef(0);
  const analysisEpochRef = useRef(0);
  const pendingAccountAutoRunRef = useRef<SocialInspectVO | null>(null);
  const downloadBusyRef = useRef(false);
  const downloadEpochRef = useRef(0);
  const downloadClickRef = useRef({ id: "", at: 0 });
  const ownerUserId = user?.id ?? "";
  const previousOwnerRef = useRef(ownerUserId);
  const skillRun = useSkillRun({
    storageKey: "tidecanvas.social-analysis.active-run",
    ownerUserId,
    retainTerminalPointer: true,
    // History owns both the platform snapshot and its report. An older local
    // run pointer must not compete with the newest server record on refresh.
    autoRestore: false,
  });

  useEffect(() => {
    if (previousOwnerRef.current === ownerUserId) return;
    previousOwnerRef.current = ownerUserId;
    setTab("breakdown");
    setKind("content");
    setURL("");
    setDownloadSource("");
    setDownloadQuality("compat");
    setFocus(DEFAULT_FOCUS);
    setEditingContentFocus(false);
    inspectEpochRef.current += 1;
    analysisEpochRef.current += 1;
    pendingAccountAutoRunRef.current = null;
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
    setWatchedDownloadRecordId("");
    setDownloadError("");
    setDownloadBusy(false);
    downloadBusyRef.current = false;
    downloadClickRef.current = { id: "", at: 0 };
    setResult(null);
    setSelectedWork(null);
    setError("");
    setStrategyError("");
    setHistoricalRecord(null);
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
  // 解析,下载看本站下载器。此前两块各写一遍状态,是重复与错位的来源。
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

  const clearHistoricalView = () => {
    if (historicalRecord?.type === "analysis" && historicalRecord.analysisRunId) skillRun.clear();
    setHistoricalRecord(null);
  };

  const inspect = async () => {
    if (inspectBusyRef.current || !url.trim()) return;
    setEditingContentFocus(false);
    clearHistoricalView();
    if (!skillRun.run && skillRun.error) skillRun.clear();
    inspectBusyRef.current = true;
    const epoch = ++inspectEpochRef.current;
    setLoading(true);
    setError("");
    setStrategyError("");
    pendingAccountAutoRunRef.current = null;
    setResult(null);
    setSelectedWork(null);
    try {
      if (!await ensureSession()) return;
      const response = await socialAnalysisApi.inspect({ url: url.trim(), kind });
      if (epoch !== inspectEpochRef.current) return;
      setHistoryRefresh((value) => value + 1);
      if (!response.success || !response.data) {
        setError(response.code === 429 ? "请求过于频繁，请稍后再试" : response.message || "链接解析失败，请检查后重试");
        return;
      }
      if (response.data.kind === "account") pendingAccountAutoRunRef.current = response.data;
      setResult(response.data);
      setSelectedWork(response.data.content ?? response.data.works[0] ?? null);
      if (response.data.kind === "account" && (focus === DEFAULT_FOCUS || focus === IMAGE_DEFAULT_FOCUS)) {
        setFocus(ACCOUNT_DEFAULT_FOCUS);
      } else if (
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
    setEditingContentFocus(false);
    clearHistoricalView();
    const contentSkillMode = currentWork && isVideoWork(currentWork) ? "video" : "image";
    const contentImageURLs = currentWork ? workImageSources(currentWork) : [];
    const contentAssetURL = contentSkillMode === "video" ? currentWork && workVideoSources(currentWork)[0] : contentImageURLs[0];
    if (result.kind === "content" && !contentAssetURL) return;
    const skillMode = result.kind === "account" ? "account" : contentSkillMode;
    const skillLabel = skillMode === "account" ? "账号拆解" : skillMode === "image" ? "图片分析" : "视频分析";
    analysisBusyRef.current = true;
    const epoch = ++analysisEpochRef.current;
    setArchiving(true);
    setError("");
    setStrategyError("");
    const reportStartError = (message: string) => {
      if (result.kind === "account") setStrategyError(message);
      else setError(message);
    };
    try {
      if (!await ensureSession()) return;
      const skill = await loadAnalysisSkill(skillMode);
      if (epoch !== analysisEpochRef.current) return;
      if (!skill) {
        reportStartError(`${skillLabel}技能未上架，请联系管理员检查技能配置`);
        return;
      }
      let assets: Array<{ id?: string; type: "video" | "image"; url?: string; name?: string; role?: string; metadata?: Record<string, unknown> }> = [];
      let prompt = "";
      const sourceURL = result.kind === "account"
        ? result.sourceUrl
        : currentWork?.pageUrl || result.sourceUrl || "";
      if (result.kind === "content" && currentWork && contentAssetURL) {
        const mediaCandidates = contentSkillMode === "video"
          ? workVideoSources(currentWork)
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
          reportStartError(`${contentSkillMode === "video" ? "视频" : "图片"}归档失败：${lastArchive?.message || "暂时无法读取素材"}。${contentSkillMode === "video" ? "已尝试可用镜像；" : ""}如果页面已打开较久，请重新解析作品以刷新临时地址。`);
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
          parameters: {
            platform: currentPlatform,
            sourceUrl: sourceURL,
            sourceFetchedAt: result.fetchedAt,
            analysisMode: skillMode,
            ...(result.recordId ? { activityRecordId: result.recordId } : {}),
          },
        },
      });
      if (epoch !== analysisEpochRef.current) return;
      if (!started) {
        reportStartError(skillRun.error || `${skillLabel}技能启动失败，请稍后重试`);
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

  useEffect(() => {
    if (!result || result.kind !== "account" || pendingAccountAutoRunRef.current !== result) return;
    pendingAccountAutoRunRef.current = null;
    if (!result.profile && result.works.length === 0) return;
    queueMicrotask(() => { void startDeepAnalysis(); });
    // The pending ref is set only by a fresh successful account inspection and
    // cleared synchronously before launch. Depending on result alone prevents
    // controller polling renders or Strict Mode replay from starting a second
    // paid run for the same snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  const performRunAction = async (action: SkillRunAction, payload?: SkillRunPanelActionPayload) => {
    const runId = skillRun.run?.id;
    if (!runId || runActionRef.current?.runId === runId) return;
    const pending = { runId };
    runActionRef.current = pending;
    const analysisEpoch = analysisEpochRef.current;
    const inspectEpoch = inspectEpochRef.current;
    setError("");
    try {
      const updated = await skillRun.performAction(action, {
        ...(payload?.feedback ? { feedback: payload.feedback } : {}),
        ...(payload?.input ? { input: payload.input } : {}),
      });
      // A double click is a no-op, and a late failure from a previous snapshot
      // must not overwrite the report the user is now viewing.
      if (runActionRef.current !== pending || analysisEpoch !== analysisEpochRef.current || inspectEpoch !== inspectEpochRef.current) return;
      if (!updated) setError("操作失败，请稍后重试");
    } finally {
      if (runActionRef.current === pending) runActionRef.current = null;
    }
  };

  const resolveVideoDownload = async (qualityOverride?: VideoDownloadQuality) => {
    if (downloadBusyRef.current || !downloadSource.trim()) return;
    // 结果面板里切换画质会立即重解析,此时 state 尚未更新,必须用传入值。
    const targetQuality = qualityOverride ?? downloadQuality;
    // A valid preview already has this quality. Repeated clicks (including
    // Enter followed by the button) must not resolve and issue another ticket.
    if (!historicalRecord && downloadResult?.quality === targetQuality && downloadResult.expiresAt * 1000 > Date.now() + 10_000) {
      setDownloadError("");
      return;
    }
    clearHistoricalView();
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
    if (!downloadResult || downloadBusyRef.current) return;
    if (downloadResult.expiresAt * 1000 <= Date.now()) {
      setDownloadResult(null);
      setDownloadError("下载地址已经过期，请重新解析视频");
      return;
    }
    const now = Date.now();
    const downloadKey = downloadResult.recordId || downloadResult.downloadUrl;
    if (downloadClickRef.current.id === downloadKey && now - downloadClickRef.current.at < 2000) return;
    downloadClickRef.current = { id: downloadKey, at: now };
    setWatchedDownloadRecordId(downloadResult.recordId || "");
    startNativeDownload(downloadResult.downloadUrl);
    setHistoryRefresh((value) => value + 1);
    toast.info("正在准备视频，完成后将由浏览器下载，可在左侧查看状态");
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
      const context = analysisRunContext(input);
      const editableContent = !accountRun && result?.kind === "content" && currentWork &&
        context.sourceUrl === (currentWork.pageUrl || result.sourceUrl).trim() &&
        context.sourceFetchedAt === result.fetchedAt &&
        (isVideoWork(currentWork) ? workVideoSources(currentWork).length > 0 : workImageSources(currentWork).length > 0);
      if (editableContent) {
        // Editing the current report needs neither a fresh platform request nor
        // a new paid run. Keep its snapshot and expose the restored focus field.
        setTab("breakdown");
        setError("");
        setEditingContentFocus(true);
        skillRun.clear();
        return;
      }
    }
    // 重新编辑始终回到拆解页签:运行面板只属于拆解,留在下载页会失去上下文。
    setTab("breakdown");
    setEditingContentFocus(false);
    setError("");
    clearHistoricalView();
    setResult(null);
    setSelectedWork(null);
    skillRun.clear();
  };

  // ARIA tabs 模式:roving tabindex 让整组页签只占一个 Tab 停靠点,
  // 因此必须由方向键在页签间移动——只做 tabIndex 不接方向键,
  // 键盘用户会被困在当前页签上,永远到不了另一个。
  const tabRefs = useRef<Partial<Record<WorkbenchTab, HTMLButtonElement | null>>>({});
  const focusTab = (next: WorkbenchTab) => {
    if ((next === "download" && historicalRecord?.type === "analysis") || (next === "breakdown" && historicalRecord?.type === "download")) {
      clearHistoricalView();
    }
    setTab(next);
    tabRefs.current[next]?.focus();
  };
  const onTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const order: WorkbenchTab[] = ["download", "breakdown"];
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

  const accountRunPresentation = analysisRunMode(skillRun.run?.input) === "account" ||
    (!!skillRun.run && skillRun.run.skillId === status?.accountAnalysisSkillId);
  const contentRunMode = analysisRunMode(skillRun.run?.input) ||
    (skillRun.run?.skillId === status?.videoAnalysisSkillId ? "video" :
      skillRun.run?.skillId === status?.imageAnalysisSkillId ? "image" : "");
  const contentRunPresentation = (contentRunMode === "video" || contentRunMode === "image") &&
    skillRun.run?.status !== "waiting_input" && skillRun.run?.status !== "waiting_confirmation";
  const runDetails = skillRun.run ? accountRunPresentation ? (
    <AccountStrategyReport
      key={skillRun.run.id}
      run={skillRun.run}
      busy={skillRun.actionBusy}
      onAction={performRunAction}
      onReEdit={reEditRun}
      onDismiss={() => skillRun.clear()}
    />
  ) : contentRunPresentation ? (
    <ContentAnalysisReport
      key={skillRun.run.id}
      run={skillRun.run}
      text={accountReportText(skillRun.run)}
      image={contentRunMode === "image"}
      busy={skillRun.actionBusy}
      onAction={performRunAction}
      onReEdit={reEditRun}
      onDismiss={() => skillRun.clear()}
      renderMarkdown={renderAnalysisMarkdown}
      reportTime={displaySnapshotTime(skillRun.run.completeTime || skillRun.run.updateTime || skillRun.run.createTime || "")}
    />
  ) : (
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

  const restoreActivityRecord = async (record: SocialActivityRecordDetailVO, automatic = false) => {
    if (useAuthStore.getState().user?.id !== record.userId) return;
    setEditingContentFocus(false);
    pendingAccountAutoRunRef.current = null;
    inspectEpochRef.current += 1;
    inspectBusyRef.current = false;
    const epoch = ++analysisEpochRef.current;
    analysisBusyRef.current = false;
    downloadEpochRef.current += 1;
    downloadBusyRef.current = false;
    setDownloadBusy(false);
    setLoading(false);
    setArchiving(false);
    setError("");
    setStrategyError("");

    if (record.type === "download") {
      setDownloadSource(record.sourceUrl);
      if (record.quality === "quality" || record.quality === "compat" || record.quality === "speed") {
        setDownloadQuality(record.quality);
      }
      setDownloadResult(null);
      setDownloadError("");
      setHistoricalRecord(record);
      setTab("download");
      skillRun.clear();
      return;
    }

    if (!isSocialInspectSnapshot(record.snapshot)) {
      setHistoricalRecord(record);
      setTab("breakdown");
      setKind(record.kind === "account" ? "account" : "content");
      setURL(record.sourceUrl);
      setResult(null);
      setSelectedWork(null);
      skillRun.clear();
      setError(record.errorMessage || "");
      if (!automatic && !record.errorMessage) toast.info("这条旧记录没有保存数据快照，无法直接复现；可以重新获取最新数据");
      return;
    }
    const snapshot = record.snapshot;
    setHistoricalRecord(record);
    setTab("breakdown");
    setKind(snapshot.kind);
    setURL(snapshot.sourceUrl);
    setResult(snapshot);
    setSelectedWork(snapshot.content ?? snapshot.works[0] ?? null);
    if (snapshot.kind === "account") setFocus(ACCOUNT_DEFAULT_FOCUS);
    else if (snapshot.content && !isVideoWork(snapshot.content)) setFocus(IMAGE_DEFAULT_FOCUS);
    else setFocus(DEFAULT_FOCUS);

    if (record.analysisRunId) {
      // Stop polling a previously selected report before loading another one.
      skillRun.clear();
      const restored = await skillRun.resume(record.analysisRunId);
      if (epoch !== analysisEpochRef.current) return;
      if (!restored) {
        const message = "当时的 AI 报告暂时无法恢复，请稍后重试或获取最新数据";
        if (snapshot.kind === "account") setStrategyError(message);
        else setError(message);
      }
    } else {
      skillRun.clear();
    }
  };

  const latestActivity = useLatestActivity(ownerUserId, (record) => restoreActivityRecord(record, true));

  const refreshHistoricalRecord = () => {
    const record = historicalRecord;
    if (!record) return;
    if (record.type === "download") void resolveVideoDownload();
    else void inspect();
  };

  const pageHeading = tab === "download" ? "视频下载" : kind === "account" ? "账号分析" : "作品分析";
  const pageDescription = tab === "download"
    ? "解析公开视频并选择合适画质保存到本地。"
    : kind === "account"
      ? "读取账号与近期作品，判断内容表现和可复用规律。"
      : "还原单个作品数据，并基于真实素材完成深度拆解。";

  return (
    <main
      className={styles.page}
      onPointerDownCapture={(event) => {
        if (event.target instanceof Element && event.target.closest("button, input, textarea, select, a")) latestActivity.cancel();
      }}
      onKeyDownCapture={latestActivity.cancel}
      onChangeCapture={latestActivity.cancel}
    >
      <ActivityHistorySidebar
        key={ownerUserId || "anonymous"}
        selectedId={historicalRecord?.id}
        watchId={watchedDownloadRecordId}
        refreshKey={historyRefresh}
        onSelect={(record) => { latestActivity.cancel(); return restoreActivityRecord(record); }}
      />
      <div className={styles.workspaceMain}>
        <div className={`${styles.canvas} ${tab === "breakdown" && result ? styles.canvasWide : ""}`}>
        <header className={styles.pageHeader}>
          <h1>{pageHeading}</h1>
          <p>{pageDescription}</p>
        </header>

        <div className={styles.tabBar}>
          <div className={styles.tabs} role="tablist" aria-label="拆解工作台">
            <button
              type="button"
              role="tab"
              id="analysis-tab-download"
              aria-selected={tab === "download"}
              aria-controls="analysis-panel-download"
              tabIndex={tab === "download" ? 0 : -1}
              ref={(node) => { tabRefs.current.download = node; }}
              className={tab === "download" ? styles.tabActive : ""}
              onClick={() => { setTab("download"); if (historicalRecord?.type === "analysis") clearHistoricalView(); }}
              onKeyDown={onTabKeyDown}
            >
              视频下载
            </button>
            <button
              type="button"
              role="tab"
              id="analysis-tab-breakdown"
              aria-selected={tab === "breakdown"}
              aria-controls="analysis-panel-breakdown"
              tabIndex={tab === "breakdown" ? 0 : -1}
              ref={(node) => { tabRefs.current.breakdown = node; }}
              className={tab === "breakdown" ? styles.tabActive : ""}
              onClick={() => { setTab("breakdown"); if (historicalRecord?.type === "download") clearHistoricalView(); }}
              onKeyDown={onTabKeyDown}
            >
              内容拆解
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

        {!historicalRecord && (latestActivity.restoring || latestActivity.error) ? (
          <div className={styles.snapshotNotice} role="status">
            {latestActivity.restoring ? <Loader2 className={styles.spin} aria-hidden /> : <CircleAlert aria-hidden />}
            <span>
              <strong>{latestActivity.restoring ? "正在恢复最新记录" : latestActivity.error}</strong>
              <small>读取已保存的数据与报告，不会重新分析或扣除积分</small>
            </span>
            {latestActivity.error ? <button type="button" onClick={latestActivity.retry}>重试恢复</button> : null}
          </div>
        ) : null}

        {historicalRecord ? (
          <div className={styles.snapshotNotice} role="status">
            <History aria-hidden />
            <span>
              <strong>{historicalRecord.type === "analysis" && !isSocialInspectSnapshot(historicalRecord.snapshot) ? "这条历史记录没有数据快照" : "正在查看历史快照"}</strong>
              <small>当时调用：{displaySnapshotTime(historicalRecord.createTime)} · {historicalRecord.type === "analysis" && !isSocialInspectSnapshot(historicalRecord.snapshot) ? "可使用原链接获取最新数据" : "当前内容不会重新请求平台"}</small>
            </span>
            <button type="button" onClick={refreshHistoricalRecord}>获取最新数据</button>
          </div>
        ) : null}

        {tab === "breakdown" ? (
          <div className={styles.panel} role="tabpanel" id="analysis-panel-breakdown" aria-labelledby="analysis-tab-breakdown">
            <section className={`${styles.composer}${result || loading ? ` ${styles.composerWithDashboard}` : ""}`}>
              <div className={styles.modeSwitch} aria-label="拆解对象">
                <button type="button" aria-pressed={kind === "content"} disabled={loading || archiving} className={kind === "content" ? styles.modeActive : ""} onClick={() => { setKind("content"); setFocus(DEFAULT_FOCUS); setResult(null); setSelectedWork(null); setError(""); setStrategyError(""); clearHistoricalView(); }}>
                  <Film aria-hidden /> 单个作品
                </button>
                <button type="button" aria-pressed={kind === "account"} disabled={loading || archiving} className={kind === "account" ? styles.modeActive : ""} onClick={() => { setKind("account"); setFocus(ACCOUNT_DEFAULT_FOCUS); setResult(null); setSelectedWork(null); setError(""); setStrategyError(""); clearHistoricalView(); }}>
                  <UserRoundSearch aria-hidden /> 整个账号
                </button>
              </div>
              <label className={styles.urlField}>
                <span>{kind === "content" ? "作品链接" : "账号主页链接"}</span>
                <div>
                  <Link2 aria-hidden />
                  <input
                    value={url}
                    onChange={(event) => { setURL(event.target.value); clearHistoricalView(); }}
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
                    key={`${result.sourceUrl}:${result.fetchedAt}`}
                    result={result}
                    focus={focus}
                    busy={archiving || skillRun.loading}
                    runDetails={contextualRunDetails}
                    skillError={contextualSkillError || strategyError}
                    historical={historicalRecord?.type === "analysis"}
                    hasSavedReport={!!historicalRecord?.analysisRunId}
                    downloaderPlatforms={downloaderPlatforms}
                    onRun={() => void startDeepAnalysis()}
                    onDownloadWork={(work) => {
                      setDownloadSource(work.pageUrl || "");
                      setDownloadResult(null);
                      setDownloadError("");
                      clearHistoricalView();
                      setTab("download");
                    }}
                  />
                ) : (
                  currentWork ? (
                    <ContentDashboard
                      key={`${currentWork.id || currentWork.pageUrl}:${result.fetchedAt}`}
                      result={result}
                      work={currentWork}
                      focus={focus}
                      busy={archiving || skillRun.loading}
                      runDetails={contextualRunDetails}
                      skillError={contextualSkillError}
                      historical={historicalRecord?.type === "analysis"}
                      hasSavedReport={!!historicalRecord?.analysisRunId}
                      editingFocus={editingContentFocus}
                      onRefresh={() => void inspect()}
                      canDownload={!!currentWork.pageUrl && isVideoWork(currentWork) && downloaderPlatforms.includes(result.platform)}
                      onFocusChange={setFocus}
                      onRun={() => void startDeepAnalysis()}
                      onDownload={() => {
                        if (!currentWork.pageUrl) return;
                        setDownloadSource(currentWork.pageUrl);
                        setDownloadResult(null);
                        setDownloadError("");
                        clearHistoricalView();
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
                  <span>点击下载视频</span>
                </p>
                <div className={styles.getterField} data-recognized={recognizedSource ? "true" : "false"}>
                  <span className={styles.getterMark} aria-hidden>
                    {recognizedSource ? <Check /> : <Link2 />}
                  </span>
                  <input
                    value={downloadSource}
                    onChange={(event) => { setDownloadSource(event.target.value); setDownloadResult(null); setDownloadError(""); clearHistoricalView(); }}
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
                  {initialized && !user ? (
                    <Link className={styles.primaryButton} href="/login">登录后下载 <ChevronRight aria-hidden /></Link>
                  ) : (
                    <button className={styles.primaryButton} type="button" disabled={!downloadSource.trim() || !downloaderReady || downloadBusy} onClick={() => void resolveVideoDownload()}>
                      {downloadBusy ? <Loader2 className={styles.spin} aria-hidden /> : <Download aria-hidden />}
                      {downloadBusy ? "正在获取视频" : "下载视频"}
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
                  <div className={styles.notice}><CircleAlert aria-hidden /> 视频下载服务当前未启用或尚未就绪，请联系管理员检查下载服务。</div>
                )}
                {user && downloaderStatusError && (
                  <div className={styles.notice}><CircleAlert aria-hidden /> 暂时无法读取下载器能力，可点击右上角状态重新检查。</div>
                )}
                {downloadError && <div className={styles.error} role="alert"><CircleAlert aria-hidden /><span>{downloadError}</span></div>}
              </section>

              {historicalRecord?.type === "download" ? (
                <section className={styles.historicalDownload}>
                  <header><History aria-hidden /><span><strong>{historicalRecord.title || "公开视频"}</strong><small>历史下载记录 · 不会自动重新解析</small></span></header>
                  <dl>
                    <div><dt>当时状态</dt><dd>{ACTIVITY_STATUS_LABEL[historicalRecord.status] || historicalRecord.status}</dd></div>
                    <div><dt>请求画质</dt><dd>{DOWNLOAD_QUALITY.find((option) => option.key === historicalRecord.quality)?.label || historicalRecord.quality || "未记录"}</dd></div>
                    <div><dt>画面尺寸</dt><dd>{historicalRecord.width && historicalRecord.height ? `${historicalRecord.width}×${historicalRecord.height}` : "未返回"}</dd></div>
                    <div><dt>文件大小</dt><dd>{displayBytes(historicalRecord.downloadedBytes || historicalRecord.estimatedBytes || 0)}</dd></div>
                  </dl>
                  {historicalRecord.errorMessage ? <p>{historicalRecord.errorMessage}</p> : null}
                </section>
              ) : null}

              {downloadResult ? (
                <>
                  <section className={styles.posterCard}>
                    <DownloadPoster key={downloadResult.id} result={downloadResult} refreshing={downloadBusy} onRefresh={() => void resolveVideoDownload()} onDuration={(seconds) => {
                      setDownloadResult((current) => current?.id === downloadResult.id && !current.durationSeconds ? { ...current, durationSeconds: seconds } : current);
                    }} />
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
              ) : historicalRecord?.type === "download" ? null : downloadBusy ? (
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
      </div>
    </main>
  );
}
