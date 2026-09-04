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
  ArrowUpRight,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  Copy,
  Download,
  FileVideo,
  Eye,
  Film,
  Heart,
  Library,
  Link2,
  Loader2,
  MessageCircle,
  ScanSearch,
  ShieldCheck,
  Share2,
  Sparkles,
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
    // 平台图床按 Referer 防盗链(实测 i0.hdslb.com:无 Referer 200 / 跨站 Referer 403),
    // 浏览器默认会带上本站地址,必须显式声明不发送,否则封面一律加载失败。
    // eslint-disable-next-line @next/next/no-img-element
    return <img className={styles.workCoverImage} src={work.coverUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedUrl(work.coverUrl || "")} />;
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
      <input readOnly value={value} onFocus={(event) => event.currentTarget.select()} />
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
            <section className={styles.composer}>
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
                <header className={styles.sectionHeader}>
                  <h2>{result.kind === "account" ? "账号与作品样本" : "作品事实卡"}</h2>
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
                        {/* 两侧平台集合并不相同(拆解有抖音/小红书,下载器有
                            Pinterest/Instagram)。只在这条来源确实可下载时才给入口,
                            否则用户跳过去必然解析失败。 */}
                        {downloaderPlatforms.includes(result.platform) && (
                          <button
                            type="button"
                            className={styles.bridgeButton}
                            onClick={() => {
                              setDownloadSource(currentWork.pageUrl || result.sourceUrl || "");
                              setDownloadResult(null);
                              setDownloadError("");
                              setTab("download");
                            }}
                          >
                            <Download aria-hidden /> 到「视频下载」取这条原片
                          </button>
                        )}
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
                      <h3>{kind === "account" ? "AI 账号策略拆解" : "AI 视频深度拆解"}</h3>
                      <p>{kind === "account"
                        ? "基于账号资料与近期作品样本，分析定位、内容支柱和表现差异，并给出可执行的选题与测试建议。"
                        : "视频会先安全归档到你的资产库，再交给视频分析技能提取音轨与关键帧。页面关闭后任务仍可恢复。"}</p>
                      <label className={styles.focusField}>
                        <span>你希望重点分析什么</span>
                        <textarea rows={5} value={focus} onChange={(event) => setFocus(event.target.value)} maxLength={4000} />
                        <small>{focus.length} / 4000</small>
                      </label>
                      <div className={styles.aiActionRow}>
                        <span className={styles.footNote}><Library aria-hidden /> {kind === "account" ? "仅使用当前公开样本" : "分析素材自动进入资产库"}</span>
                        <button
                          type="button"
                          className={styles.primaryButton}
                          disabled={(kind === "content" ? !currentWork?.mediaUrl : !result.profile && result.works.length === 0) || archiving || skillRun.loading || !!skillRun.run}
                          onClick={() => void startDeepAnalysis()}
                        >
                          {archiving || skillRun.loading ? <Loader2 className={styles.spin} aria-hidden /> : <ScanSearch aria-hidden />}
                          {archiving
                            ? kind === "account" ? "正在启动分析" : "正在归档视频"
                            : skillRun.loading ? "正在启动技能"
                              : kind === "account" ? "生成账号拆解" : "开始深度拆解"}
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
            ) : runDetails ? (
              <section className={styles.resultSection}>
                <header className={styles.sectionHeader}>
                  <h2>{skillRun.run?.skillTitle || "拆解任务"}</h2>
                </header>
                {runDetails}
              </section>
            ) : loading ? (
              <section className={styles.resultSection} aria-busy="true">
                <p className={styles.loadingNote} role="status">正在读取平台数据…</p>
                <ResultSkeleton />
              </section>
            ) : (
              <div className={styles.empty}>
                <Film aria-hidden />
                <strong>先还原事实，再解释方法</strong>
                <p>标题、作者、发布时间与互动指标直接来自平台，不由 AI 猜测；随后 AI 依据视频或账号样本给出带时间码证据的拆解。</p>
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
                <div className={styles.getterField} data-recognized={extractDownloadURL(downloadSource) ? "true" : "false"}>
                  <span className={styles.getterMark} aria-hidden>
                    {extractDownloadURL(downloadSource) ? <Check /> : <Link2 />}
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
                            aria-pressed={downloadQuality === option.key}
                            className={downloadQuality === option.key ? styles.formatSwitchActive : ""}
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
