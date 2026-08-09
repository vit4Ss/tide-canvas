"use client";

/* ============================================================================
   AssetsBrowser — the 资产 (Assets) UI, reusable as a full page (资产 route) and
   as a picker dialog (创作台 参考图「从资产库选取」). Ported from the assets page.

   - Default (browse) mode: clicking a card opens the asset in a new tab.
   - Pick mode (`onPick` set): clicking a card returns its URL to the caller and
     the card shows a 选择 affordance; the 批量操作 / 同步 actions are hidden.
   ========================================================================== */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { aiApi, fileApi, uploadFileSmart } from "@/lib/api";
import { fetchWithAuth } from "@/lib/http";
import { useAuthStore } from "@/stores/use-auth-store";
import { FileCategory, type FileVO } from "@/types/file";
import { AiTaskStatus, type AiTaskVO } from "@/types/ai";
import { mesh } from "@/lib/mesh";
import { fallbackOssDisplayImage, ossDisplayUrl, restoreOssDisplayImage } from "@/lib/oss-display";
import { toast } from "@/components/shared/toast";
import { confirmDialog } from "@/components/shared/confirm";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { AudioPlayerCard, SongCard } from "@/components/studio/audio-player-card";
import {
  HANDLER_MEDIA_KIND,
  assetViewKey,
  filtersForAssetTab,
  initialAssetTab,
  isHistoryFilter,
  type AssetFilterKey as FilterKey,
  type AssetMediaKind as MediaKind,
  type AssetTabKey as TabKey,
  type HistoryFilterKey,
} from "@/components/studio/assets-browser-policy";


/** A picked asset handed back to the caller in pick mode. */
export interface PickedAsset {
  url: string;
  name: string;
  kind: MediaKind;
}

const TABS: { t: TabKey; label: string }[] = [
  { t: "hist", label: "生成历史" },
  { t: "upload", label: "上传历史" },
];

const FILTERS: { f: FilterKey; label: string }[] = [
  { f: "character", label: "角色" },
  { f: "scene", label: "场景" },
  { f: "image", label: "图片" },
  { f: "video", label: "视频" },
  { f: "audio", label: "音频" },
  { f: "3d", label: "3D" }, // 生成历史专属（policy 的 UPLOAD_FILTER_KEYS 不含它）
  { f: "doc", label: "文档" },
];

const FILTER_TO_CATEGORY: Record<FilterKey, FileCategory> = {
  character: FileCategory.CHARACTER,
  scene: FileCategory.SCENE,
  image: FileCategory.GENERAL,
  video: FileCategory.GENERAL,
  audio: FileCategory.GENERAL,
  "3d": FileCategory.GENERAL, // 上传标签页不出现 3d；仅补全 Record 类型
  doc: FileCategory.GENERAL,
};

const FILE_GLYPH: Record<string, string> = { audio: "♪", doc: "▤", video: "▶" };
const ACCEPT: Record<FilterKey, string> = {
  character: "image/*",
  scene: "image/*",
  image: "image/*",
  video: "video/*",
  audio: "audio/*",
  "3d": ".glb,.obj,.stl,.fbx,.usdz", // 上传标签页不出现 3d；仅补全 Record 类型
  doc: ".pdf,.doc,.docx,.txt,.md,.ppt,.pptx,.xls,.xlsx",
};

const ACCEPT_HINT: Record<FilterKey, string> = {
  character: "仅支持角色图片",
  scene: "仅支持场景图片",
  image: "仅支持图片",
  video: "仅支持视频",
  audio: "仅支持音频",
  "3d": "仅支持 3D 模型文件",
  doc: "支持 PDF、Office 与文本文件",
};

const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "m4a", "aac", "flac", "ogg"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "webm", "mkv", "avi"]);
const IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif", "avif", "bmp"]);
const DOC_EXTENSIONS = new Set(["pdf", "doc", "docx", "txt", "md", "ppt", "pptx", "xls", "xlsx"]);

function uploadMatchesFilter(file: File, filter: FilterKey): boolean {
  const mime = file.type.toLowerCase();
  const extension = file.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  if (filter === "character" || filter === "scene" || filter === "image") {
    return mime.startsWith("image/") || IMAGE_EXTENSIONS.has(extension);
  }
  if (filter === "video") return mime.startsWith("video/") || VIDEO_EXTENSIONS.has(extension);
  if (filter === "audio") return mime.startsWith("audio/") || AUDIO_EXTENSIONS.has(extension);
  return DOC_EXTENSIONS.has(extension);
}

/** Deterministic mesh fallback for an item without a usable cover URL. */
function fallbackCover(seed: string): string {
  // 雪花 ID 是字符串：逐字符哈希（与全站其它 coverFallback 一致）
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return mesh(h, (h + 132) % 360, (h + 248) % 360);
}

/** 音频分轨信息(歌名/封面/时长/播放地址)取自 resultMeta.tracks。 */
interface AudioTrack {
  url?: string;
  title?: string;
  coverUrl?: string;
  duration?: number;
}

/** resultMeta（对象或 JSON 串）→ 宽松对象；解析失败按空处理。 */
function metaObjectOf(task: AiTaskVO): Record<string, unknown> {
  if (typeof task.resultMeta !== "string") {
    return (task.resultMeta as Record<string, unknown> | null) ?? {};
  }
  try {
    return JSON.parse(task.resultMeta || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** tracksOf 取音频任务 resultMeta.tracks 全部分轨(Suno 一次两首,缺一不可)。 */
function tracksOf(task: AiTaskVO): AudioTrack[] {
  const tracks = (metaObjectOf(task) as { tracks?: AudioTrack[] }).tracks;
  return Array.isArray(tracks) ? tracks : [];
}

/** 3D 任务的封面：resultMeta.assets 里的 previewImageUrl（上游生成的模型截图）。 */
function threeDPreviewOf(task: AiTaskVO): string | undefined {
  const assets = (metaObjectOf(task) as {
    assets?: Array<{ previewImageUrl?: unknown; preview_image_url?: unknown } | null>;
  }).assets;
  if (!Array.isArray(assets)) return undefined;
  for (const asset of assets) {
    const url = asset?.previewImageUrl ?? asset?.preview_image_url;
    if (typeof url === "string" && /^https?:\/\//.test(url)) return url;
  }
  return undefined;
}

/** 3D 下载名：模型名 + 真实扩展名（GLB 少了后缀在本地基本打不开），与
 *  downloadAsset 的 attachmentName 同一套补名逻辑。 */
function threeDDownloadName(task: AiTaskVO, url: string): string {
  return attachmentName(task.modelName || "3D 模型", url);
}

/** 3D 任务的主模型文件：resultUrl 缺失时回退 resultMeta.assets（优先 glb）——
 *  与创作台 histItemsFromTasks 的口径一致，防老数据只写了 assets 的情况。 */
function threeDModelUrlOf(task: AiTaskVO): string | undefined {
  if (task.resultUrl) return task.resultUrl;
  const assets = (metaObjectOf(task) as {
    assets?: Array<{ type?: unknown; url?: unknown } | null>;
  }).assets;
  if (!Array.isArray(assets)) return undefined;
  let first: string | undefined;
  for (const asset of assets) {
    const url = asset?.url;
    if (typeof url !== "string" || !/^https?:\/\//.test(url)) continue;
    if (String(asset?.type ?? "").toLowerCase() === "glb") return url;
    first = first ?? url;
  }
  return first;
}

/** createTime "YYYY-MM-DDTHH:MM:SS" → design's "M 月 D 日" header. */
function dateLabel(createTime: string): string {
  if (!createTime) return "未知日期";
  const t = Date.parse(createTime);
  if (Number.isNaN(t)) return createTime;
  const d = new Date(t);
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

function fmtSize(bytes: number): string {
  if (!bytes) return "";
  const mb = bytes / 1024 / 1024;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** media kind of an uploaded file (image|video|audio|doc) from its type/mime. */
function fileMediaKind(f: FileVO): MediaKind {
  if (f.fileType === "image") return "image";
  if (f.fileType === "video") return "video";
  if ((f.mimeType || "").startsWith("audio/")) return "audio";
  return "doc";
}

function isConceptFilter(filter: FilterKey): filter is "character" | "scene" {
  return filter === "character" || filter === "scene";
}

function taskMatchesHistoryFilter(task: AiTaskVO, filter: HistoryFilterKey): boolean {
  const mediaKind = HANDLER_MEDIA_KIND[task.handler];
  if (isConceptFilter(filter)) {
    return mediaKind === "image" && task.targetType === filter;
  }
  if (mediaKind !== filter) return false;
  // The plain 图片 bucket excludes generated character/scene canvas nodes.
  return filter !== "image" || !isConceptFilter(task.targetType as FilterKey);
}

function fileMatchesFilter(file: FileVO, filter: FilterKey): boolean {
  const category = file.category || FileCategory.GENERAL;
  if (filter === "character") return category === FileCategory.CHARACTER;
  if (filter === "scene") return category === FileCategory.SCENE;
  return category === FileCategory.GENERAL && fileMediaKind(file) === filter;
}

/** A previewable / downloadable asset surfaced from a card click. */
interface OpenAsset {
  url: string;
  kind: MediaKind | "3d";
  name: string;
  /** 3D 结果的预览截图（url 本身是模型文件，展示层用它）。 */
  cover?: string;
  /** 3D 结果的任务 ID（雪花字符串）：深链 /three-d?task= 精确落位到该模型。 */
  taskId?: string;
}

/** a.download 的最终文件名：blob 对象链接下浏览器只认 download 属性（服务端
 *  Content-Disposition 不生效），名字没带真实扩展名就从 URL 补上——模型名多含
 *  "3.0" 这类点号，不能拿「有没有点」当补名判定。扩展名只从 URL 的 pathname
 *  取（与服务端 path.Ext 同口径）：查询串里的签名（Signature=ab.cd）不能当后缀。 */
function attachmentName(name: string, url: string): string {
  const base = name || "download";
  let pathname = url;
  try {
    pathname = new URL(url).pathname;
  } catch {
    /* 非法 URL 按原串兜底 */
  }
  const ext = pathname.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase();
  if (!ext || base.toLowerCase().endsWith(`.${ext}`)) return base;
  return `${base}.${ext}`;
}

/** Force a download through the authenticated server proxy (bypasses CORS;
 *  same-origin /api path is rewritten to the backend by next.config), then
 *  save the blob under a filename that keeps its real extension. */
async function downloadAsset(url: string, name: string): Promise<void> {
  try {
    const finalName = attachmentName(name, url);
    const href = `/api/files/download?url=${encodeURIComponent(url)}&name=${encodeURIComponent(finalName)}`;
    const response = await fetchWithAuth(href);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blobUrl = URL.createObjectURL(await response.blob());
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = finalName;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Firefox / Safari may not have started consuming the object URL when the
    // synthetic click returns. Revoke it after the browser has had a chance to
    // enqueue the download instead of invalidating the URL synchronously.
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 5_000);
  } catch {
    toast.error("下载失败，请稍后重试");
  }
}

interface Group<T> {
  date: string;
  items: T[];
}

interface AssetViewState {
  tasks: AiTaskVO[];
  files: FileVO[];
  page: number;
  hasMore: boolean;
  multiPage: boolean;
  loading: boolean;
  loadingMore: boolean;
  loadError: boolean;
}

const EMPTY_VIEW: AssetViewState = {
  tasks: [],
  files: [],
  page: 1,
  hasMore: false,
  multiPage: false,
  loading: true,
  loadingMore: false,
  loadError: false,
};

function appendUnique<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const seen = new Set(current.map((item) => item.id));
  return [...current, ...incoming.filter((item) => !seen.has(item.id))];
}

function groupByDate<T>(rows: T[], getTime: (r: T) => string): Group<T>[] {
  const buckets = new Map<string, T[]>();
  const order: string[] = [];
  // The server already returns the requested global order. Preserve it so
  // ascending pagination appends at the bottom instead of jumping older rows
  // to the top after every page.
  for (const r of rows) {
    const key = dateLabel(getTime(r));
    let arr = buckets.get(key);
    if (!arr) {
      arr = [];
      buckets.set(key, arr);
      order.push(key);
    }
    arr.push(r);
  }
  return order.map((date) => ({ date, items: buckets.get(date)! }));
}

export function AssetsBrowser({
  pickMode = false,
  onPick,
  defaultTab = "hist",
  defaultFilter = "image",
}: {
  /** when true, cards select instead of opening, and 批量/同步 actions are hidden */
  pickMode?: boolean;
  onPick?: (asset: PickedAsset) => void;
  /** initial tab; unsupported generation filters are normalized to 上传历史 */
  defaultTab?: TabKey;
  /** initial media filter (image | video | audio | doc) */
  defaultFilter?: FilterKey;
}) {
  const [tab, setTab] = useState<TabKey>(() => initialAssetTab(defaultTab, defaultFilter));
  const [historyFilter, setHistoryFilter] = useState<HistoryFilterKey>(() =>
    isHistoryFilter(defaultFilter) ? defaultFilter : "image",
  );
  const [uploadFilter, setUploadFilter] = useState<FilterKey>(defaultFilter);
  const filter: FilterKey = tab === "hist" ? historyFilter : uploadFilter;
  const visibleFilters = useMemo(() => new Set(filtersForAssetTab(tab)), [tab]);
  const [viewStates, setViewStates] = useState<Record<string, AssetViewState>>({});
  const [uploading, setUploading] = useState(false);
  // in-app preview overlay target (image/video/audio); docs never set this.
  const [preview, setPreview] = useState<OpenAsset | null>(null);
  const previewDialogRef = useFocusTrap<HTMLDivElement>(!!preview);
  // 批量操作:进入多选模式后卡片改为勾选;selected 存当前 tab 内条目 id(字符串)。
  const [batchMode, setBatchMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  // 排序方向(更多筛选):false=最新在前(默认),true=最早在前。
  const [sortAsc, setSortAsc] = useState(false);

  // open a clicked asset: media (image/video/audio) previews in-app; a 文档
  // downloads straight away (per the asset-type preview rules).
  const openAsset = useCallback((item: OpenAsset) => {
    if (!item.url) {
      toast.info("该资产暂无可用内容");
      return;
    }
    if (item.kind === "doc") downloadAsset(item.url, item.name);
    else setPreview(item);
  }, []);

  const ensureSession = useAuthStore((s) => s.ensureSession);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // hand a previewed image off to the 创作台 and load it into the matching tool
  // (作为垫图 → 图生图 / 生成视频 → 图生视频首帧 / 精细编辑 → 改图).
  const sendToStudio = useCallback(
    (op: "pad" | "video" | "edit") => {
      if (!preview) return;
      try {
        sessionStorage.setItem("studio_use_asset", JSON.stringify({ url: preview.url, op }));
      } catch {
        /* sessionStorage may be unavailable */
      }
      router.push("/studio");
    },
    [preview, router],
  );

  /* ── 懒加载 + 视图缓存 ────────────────────────────────────────────────
     每个 tab/filter/date/sort 组合有独立缓存。切回已加载视图立即显示，不重复
     请求；服务端先完成媒体/状态过滤再分页，避免客户端过滤导致漏页。 */
  const PAGE_SIZE = 24;
  const cooldownRef = useRef(0);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const sentinelRef = useRef<HTMLDivElement>(null);
  const requestSeqRef = useRef(0);
  const activeRequestsRef = useRef(new Map<string, number>());
  const mountedRef = useRef(true);
  const viewKey = useMemo(
    () => assetViewKey({ tab, filter, startDate, endDate, sortAsc }),
    [tab, filter, startDate, endDate, sortAsc],
  );
  const hasCachedView = Object.prototype.hasOwnProperty.call(viewStates, viewKey);
  const currentView = viewStates[viewKey] ?? EMPTY_VIEW;
  const { tasks, files, loading, loadingMore, loadError, hasMore, multiPage } = currentView;

  useEffect(() => () => {
    mountedRef.current = false;
    activeRequestsRef.current.clear();
  }, []);

  const fetchView = useCallback(async (page: number, append: boolean, force = false) => {
    if (!force && activeRequestsRef.current.has(viewKey)) return;
    const requestId = ++requestSeqRef.current;
    activeRequestsRef.current.set(viewKey, requestId);
    try {
      await ensureSession();
      if (!mountedRef.current || activeRequestsRef.current.get(viewKey) !== requestId) return;
      setViewStates((prev) => {
        const prior = prev[viewKey];
        return {
          ...prev,
          [viewKey]: {
            ...(prior ?? EMPTY_VIEW),
            loading: !append && !prior,
            loadingMore: append,
            loadError: false,
          },
        };
      });

      const res = tab === "hist"
        ? await aiApi.listTasks({
            pageNum: page,
            pageSize: PAGE_SIZE,
            mediaType: isConceptFilter(filter) ? "image" : filter as "image" | "video" | "audio" | "3d",
            assetCategory: isConceptFilter(filter) ? filter : filter === "image" ? "general" : undefined,
            assetOnly: true,
            orderDirection: sortAsc ? "asc" : "desc",
            startDate: startDate || undefined,
            endDate: endDate || undefined,
          })
        : await fileApi.list({
            pageNum: page,
            pageSize: PAGE_SIZE,
            // 上传标签页永远拿不到 "3d"（UPLOAD_FILTER_KEYS 不含），断言仅类型收窄
            mediaKind: isConceptFilter(filter) ? "image" : (filter as MediaKind),
            category: FILTER_TO_CATEGORY[filter],
            orderDirection: sortAsc ? "asc" : "desc",
            startDate: startDate || undefined,
            endDate: endDate || undefined,
          });
      if (!mountedRef.current || activeRequestsRef.current.get(viewKey) !== requestId) return;
      if (!res.success || !res.data) throw new Error(res.message || "asset list failed");

      const records = res.data.records;
      const hasNextPage = page * res.data.pageSize < res.data.total;
      setViewStates((prev) => {
        const prior = prev[viewKey] ?? EMPTY_VIEW;
        return {
          ...prev,
          [viewKey]: {
            tasks: tab === "hist"
              ? appendUnique(append ? prior.tasks : [], records as AiTaskVO[])
              : [],
            files: tab === "upload"
              ? appendUnique(append ? prior.files : [], records as FileVO[])
              : [],
            page,
            hasMore: hasNextPage,
            multiPage: append || page > 1 || prior.multiPage,
            loading: false,
            loadingMore: false,
            loadError: false,
          },
        };
      });
    } catch {
      if (!mountedRef.current || activeRequestsRef.current.get(viewKey) !== requestId) return;
      setViewStates((prev) => {
        const prior = prev[viewKey] ?? EMPTY_VIEW;
        return {
          ...prev,
          [viewKey]: {
            ...prior,
            loading: false,
            loadingMore: false,
            loadError: true,
          },
        };
      });
    } finally {
      if (activeRequestsRef.current.get(viewKey) === requestId) {
        activeRequestsRef.current.delete(viewKey);
      }
    }
  }, [ensureSession, endDate, filter, sortAsc, startDate, tab, viewKey]);

  useEffect(() => {
    if (hasCachedView) return;
    const frame = window.requestAnimationFrame(() => void fetchView(1, false));
    return () => window.cancelAnimationFrame(frame);
  }, [fetchView, hasCachedView]);

  const loadMore = useCallback(() => {
    // 触发冷却:一次点火后 700ms 内忽略后续交点,消除连发的抽搐感
    const now = Date.now();
    if (now - cooldownRef.current < 700) return;
    cooldownRef.current = now;
    void fetchView(currentView.page + 1, true);
  }, [currentView.page, fetchView]);

  const retryCurrentView = useCallback(() => {
    void fetchView(1, false, true);
  }, [fetchView]);

  // 底部哨兵:进入视口提前量即续页。
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadMore();
      },
      { rootMargin: "320px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loadMore]);

  // A processing task otherwise remains stuck at “生成中” until navigation.
  // Poll only the first page and refresh it in place so the list never flashes.
  useEffect(() => {
    if (
      tab !== "hist" ||
      currentView.page !== 1 ||
      !tasks.some((task) => task.status === AiTaskStatus.PROCESSING)
    ) return;
    const timer = window.setTimeout(() => void fetchView(1, false, true), 3_000);
    return () => window.clearTimeout(timer);
  }, [currentView.page, fetchView, tab, tasks]);

  // Escape closes the preview overlay.
  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPreview(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [preview]);

  // The server filters media/status before pagination. The small defensive
  // checks below keep malformed legacy responses from leaking into the UI.
  const taskGroups = useMemo(() => {
    if (tab !== "hist") return [];
    const matched = tasks.filter(
      (t) =>
        taskMatchesHistoryFilter(t, historyFilter) &&
        t.status !== AiTaskStatus.FAILED &&
        t.status !== AiTaskStatus.CANCELLED,
    );
    return groupByDate(matched, (t) => t.createTime);
  }, [historyFilter, tab, tasks]);

  // uploaded files of the active media kind, date-grouped.
  const fileGroups = useMemo(() => {
    if (tab !== "upload") return [];
    const matched = files.filter((f) => fileMatchesFilter(f, filter));
    return groupByDate(matched, (f) => f.createTime);
  }, [tab, filter, files]);

  const groupsEmpty = tab === "hist" ? taskGroups.length === 0 : fileGroups.length === 0;

  // 切换视图时只重置选择；分页/加载状态属于各自缓存，互不覆盖。
  const resetBatch = useCallback(() => {
    setBatchMode(false);
    setSelected(new Set());
  }, []);

  const switchTab = useCallback((t: TabKey) => {
    if (t === tab) return;
    setTab(t);
    resetBatch();
  }, [resetBatch, tab]);

  const switchFilter = useCallback((f: FilterKey) => {
    if (f === filter) return;
    if (tab === "hist" && isHistoryFilter(f)) setHistoryFilter(f);
    if (tab === "upload") setUploadFilter(f);
    resetBatch();
  }, [filter, resetBatch, tab]);

  const changeDates = useCallback((setter: (v: string) => void) => (v: string) => {
    setter(v);
    resetBatch();
  }, [resetBatch]);

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // 当前视图内全部条目 id(用于全选/批量操作)。
  const currentIds = useMemo(
    () =>
      tab === "hist"
        ? taskGroups.flatMap((g) => g.items.map((t) => String(t.id)))
        : fileGroups.flatMap((g) => g.items.map((f) => String(f.id))),
    [tab, taskGroups, fileGroups],
  );
  const allSelected = currentIds.length > 0 && currentIds.every((id) => selected.has(id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(currentIds));

  const exitBatch = () => {
    setBatchMode(false);
    setSelected(new Set());
  };

  const invalidateAndRefresh = useCallback(async () => {
    // Mutations can affect totals and every cached sort/date view. Retire all
    // older responses, clear the cache, then refresh the view that initiated it.
    activeRequestsRef.current.clear();
    setViewStates({});
    await fetchView(1, false, true);
  }, [fetchView]);

  // 批量删除:生成历史→cancelTask,上传历史→file delete;逐条调用现有接口。
  const batchDelete = async () => {
    if (selected.size === 0 || busy) return;
    if (
      !(await confirmDialog({
        title: "批量删除",
        message: `确认删除所选 ${selected.size} 项？此操作不可恢复。`,
        confirmText: "删除",
      }))
    )
      return;
    setBusy(true);
    let ok = 0;
    for (const id of selected) {
      try {
        const res = tab === "hist" ? await aiApi.cancelTask(id) : await fileApi.delete(id);
        if (res.success) ok++;
      } catch {
        /* 单条失败不阻断其余 */
      }
    }
    toast[ok > 0 ? "success" : "error"](ok > 0 ? `已删除 ${ok} 项` : "删除失败，请稍后重试");
    exitBatch();
    setBusy(false);
    await invalidateAndRefresh();
  };

  // 批量下载:通过下载代理逐个触发(强制附件下载)。
  const batchDownload = () => {
    const urls = new Map<string, Array<{ url: string; name: string }>>();
    if (tab === "hist") {
      tasks.forEach((task) => {
        const tracks = HANDLER_MEDIA_KIND[task.handler] === "audio" ? tracksOf(task) : [];
        const items = tracks.flatMap((track, index) =>
          track.url
            ? [{ url: track.url, name: track.title || `${task.modelName || "生成音频"} ${index + 1}` }]
            : [],
        );
        if (!items.length) {
          // 3D 的主文件可能只写在 resultMeta.assets（老数据），与卡片打开口径一致；
          // 下载名带真实扩展名（模型名含点号会绕过服务端的补后缀逻辑）
          const is3d = HANDLER_MEDIA_KIND[task.handler] === "3d";
          const url = is3d ? threeDModelUrlOf(task) : task.resultUrl;
          if (url) {
            items.push({
              url,
              name: is3d ? threeDDownloadName(task, url) : task.modelName || "生成结果",
            });
          }
        }
        if (items.length) urls.set(String(task.id), items);
      });
    } else {
      files.forEach((file) => {
        if (file.fileUrl) urls.set(String(file.id), [{ url: file.fileUrl, name: file.originalName || "文件" }]);
      });
    }
    let n = 0;
    selected.forEach((id) => {
      for (const asset of urls.get(id) ?? []) {
        void downloadAsset(asset.url, asset.name);
        n++;
      }
    });
    if (n === 0) toast.info("所选项暂无可下载内容");
  };

  // dropzone → real upload of the picked files, then reload the upload list.
  const onPickFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const selectedFiles = Array.from(list);
    const pickedFiles = selectedFiles.filter((file) => uploadMatchesFilter(file, filter));
    const rejected = selectedFiles.length - pickedFiles.length;
    if (pickedFiles.length === 0) {
      toast.error(`请选择符合“${FILTERS.find((item) => item.f === filter)?.label ?? "当前分类"}”类型的文件`);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setUploading(true);
    try {
      await ensureSession();
      let ok = 0;
      const category = FILTER_TO_CATEGORY[filter];
      // Three concurrent uploads keep multi-file batches responsive without
      // saturating the browser, OSS connection pool, or server fallback path.
      for (let i = 0; i < pickedFiles.length; i += 3) {
        const results = await Promise.all(
          pickedFiles.slice(i, i + 3).map((file) => uploadFileSmart(file, undefined, { category })),
        );
        ok += results.filter((result) => result.success).length;
      }
      const failed = pickedFiles.length - ok + rejected;
      toast[ok > 0 ? "success" : "error"](
        ok > 0
          ? failed > 0 ? `已上传 ${ok} 个，${failed} 个失败` : `已上传 ${ok} 个文件`
          : "上传失败，请稍后重试",
      );
      if (ok > 0) {
        await invalidateAndRefresh();
      }
    } catch {
      toast.error("上传失败，请稍后重试");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <main className="asset">
      <div className="asset-top">
        <div className="asset-tabs" id="asset-tabs">
          {TABS.map((x) => (
            <button
              key={x.t}
              type="button"
              className={tab === x.t ? "on" : undefined}
              aria-pressed={tab === x.t}
              onClick={() => switchTab(x.t)}
            >
              {x.label}
            </button>
          ))}
        </div>
        <div className="asset-actions">
          {!pickMode && (
            <button
              type="button"
              className={batchMode ? "on" : undefined}
              onClick={() => (batchMode ? exitBatch() : setBatchMode(true))}
            >
              ☑ {batchMode ? "退出多选" : "批量操作"}
            </button>
          )}
          {/* 「同步到剪映」原型按钮已移除（无真实功能）；仅保留上传标签页的真实上传入口 */}
          {tab === "upload" && (
            <button
              type="button"
              className="pri"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? "上传中…" : "↑ 上传文件"}
            </button>
          )}
        </div>
      </div>

      <div className="asset-filter" id="asset-filter">
        {/* 选取模式只收 image/video/audio 参考素材，3D 筛选是死路，不展示 */}
        {FILTERS.filter((x) => visibleFilters.has(x.f) && !(pickMode && x.f === "3d")).map((x) => (
          <button
            key={x.f}
            type="button"
            className={filter === x.f ? "on" : undefined}
            aria-pressed={filter === x.f}
            onClick={() => switchFilter(x.f)}
          >
            {x.label}
          </button>
        ))}
        <span className="as-dates">
          <input
            type="date"
            aria-label="开始日期"
            value={startDate}
            onChange={(e) => changeDates(setStartDate)(e.target.value)}
          />
          <i>→</i>
          <input
            type="date"
            aria-label="结束日期"
            value={endDate}
            onChange={(e) => changeDates(setEndDate)(e.target.value)}
          />
          {(startDate || endDate) && (
            <button
              type="button"
              title="清除时间筛选"
              onClick={() => {
                setStartDate("");
                setEndDate("");
                resetBatch();
              }}
            >
              ×
            </button>
          )}
        </span>
        <button
          type="button"
          onClick={() => {
            setSortAsc((v) => !v);
            resetBatch();
          }}
          title="切换排序"
          aria-pressed={sortAsc}
          style={{ marginLeft: "auto" }}
        >
          {sortAsc ? "最早在前 ↑" : "最新在前 ↓"}
        </button>
      </div>

      {/* 多选操作条:进入批量模式后出现 */}
      {batchMode && !pickMode && (
        <div
          className="asset-batchbar"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 12px",
            margin: "0 0 10px",
            borderRadius: 12,
            background: "color-mix(in oklab, var(--accent, #7c8cff) 10%, transparent)",
            border: "1px solid color-mix(in oklab, var(--accent, #7c8cff) 30%, transparent)",
            fontSize: 13,
          }}
        >
          <span>已选 {selected.size} 项</span>
          <button type="button" onClick={toggleAll} style={{ padding: "4px 10px" }}>
            {allSelected ? "取消全选" : "全选"}
          </button>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            onClick={batchDownload}
            disabled={selected.size === 0}
            style={{ padding: "4px 10px", opacity: selected.size === 0 ? 0.5 : 1 }}
          >
            ↓ 下载所选
          </button>
          <button
            type="button"
            onClick={batchDelete}
            disabled={selected.size === 0 || busy}
            style={{
              padding: "4px 10px",
              color: "#ee6b78",
              opacity: selected.size === 0 || busy ? 0.5 : 1,
            }}
          >
            {busy ? "删除中…" : "🗑 删除所选"}
          </button>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={ACCEPT[filter]}
        style={{ display: "none" }}
        onChange={(e) => onPickFiles(e.target.files)}
      />

      <div className="asset-body" id="assetBody">
        {/* 上传历史 dropzone */}
        {tab === "upload" && (
          <button
            type="button"
            className="as-dropzone"
            onClick={() => fileInputRef.current?.click()}
          >
            <span className="as-dz-ic">↑</span>
            <b>
              {uploading
                ? "正在上传…"
                : filter === "character"
                  ? "上传角色参考图片"
                  : filter === "scene"
                    ? "上传场景参考图片"
                    : "上传本地文件"}
            </b>
            <i>
              点击选择 · {ACCEPT_HINT[filter]}
            </i>
          </button>
        )}

        {loading ? (
          <div className="empty" style={{ padding: "80px 0" }}>
            正在加载资产…
          </div>
        ) : loadError && groupsEmpty ? (
          <div className="empty" style={{ padding: tab === "upload" ? "60px 0" : "80px 0" }}>
            <p>资产加载失败，请检查网络后重试</p>
            <button type="button" className="as-more retry" onClick={retryCurrentView}>
              重新加载
            </button>
          </div>
        ) : groupsEmpty ? (
          <div className="empty" style={{ padding: tab === "upload" ? "60px 0" : "80px 0" }}>
            {tab === "upload"
              ? "该类型暂无上传文件 —— 从本地上传后会出现在这里 ✦"
              : "该类型暂无生成资产 —— 生成后会归档到这里 ✦"}
          </div>
        ) : tab === "hist" ? (
          <>
            {taskGroups.map((g) => (
              <div className="asset-group" key={g.date}>
                <div className="asset-date">{g.date}</div>
                <div className="asset-grid">
                  {g.items.map((t) => (
                    <TaskCard
                      key={t.id}
                      task={t}
                      pickMode={pickMode}
                      onPick={onPick}
                      onOpen={openAsset}
                      batchMode={batchMode}
                      selected={selected.has(String(t.id))}
                      onToggle={toggleSelect}
                    />
                  ))}
                </div>
              </div>
            ))}
            {hasMore ? (
              loadError ? (
                <button type="button" className="as-more retry" onClick={loadMore}>
                  加载失败，点击重试
                </button>
              ) : (
                <div ref={sentinelRef} className="as-more" aria-hidden>
                  {loadingMore ? <span className="more-dots"><i /><i /><i /></span> : "下拉加载更多"}
                </div>
              )
            ) : multiPage ? (
              <div className="as-more end" aria-hidden>
                — 已经到底了 —
              </div>
            ) : null}
          </>
        ) : (
          <>
            {fileGroups.map((g) => (
              <div className="asset-group" key={g.date}>
                <div className="asset-date">{g.date}</div>
                <div className="asset-grid">
                  {g.items.map((f) => (
                    <UploadCard
                      key={f.id}
                      file={f}
                      pickMode={pickMode}
                      onPick={onPick}
                      onOpen={openAsset}
                      batchMode={batchMode}
                      selected={selected.has(String(f.id))}
                      onToggle={toggleSelect}
                    />
                  ))}
                </div>
              </div>
            ))}
            {hasMore ? (
              loadError ? (
                <button type="button" className="as-more retry" onClick={loadMore}>
                  加载失败，点击重试
                </button>
              ) : (
                <div ref={sentinelRef} className="as-more" aria-hidden>
                  {loadingMore ? <span className="more-dots"><i /><i /><i /></span> : "下拉加载更多"}
                </div>
              )
            ) : multiPage ? (
              <div className="as-more end" aria-hidden>
                — 已经到底了 —
              </div>
            ) : null}
          </>
        )}
      </div>

      {/* in-app preview overlay — image / video / audio; backdrop / ✕ / Esc closes */}
      {preview && (
        <div
          ref={previewDialogRef}
          tabIndex={-1}
          className="as-preview"
          role="dialog"
          aria-modal="true"
          aria-label={`${preview.name} 预览`}
          onClick={() => setPreview(null)}
        >
          <div className="as-preview-bar" onClick={(e) => e.stopPropagation()}>
            <span className="as-preview-name">{preview.name}</span>
            <button
              type="button"
              className="as-preview-dl"
              onClick={() => downloadAsset(preview.url, preview.name)}
            >
              ↓ 下载
            </button>
            <button
              type="button"
              className="as-preview-x"
              aria-label="关闭"
              onClick={() => setPreview(null)}
            >
              ✕
            </button>
          </div>
          <div className="as-preview-stage" onClick={(e) => e.stopPropagation()}>
            {preview.kind === "image" && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview.url} alt={preview.name} />
            )}
            {preview.kind === "video" && (
              <video src={preview.url} controls autoPlay playsInline />
            )}
            {preview.kind === "audio" && (
              <div className="as-preview-audio">
                <span className="as-preview-audio-ic">♪</span>
                <b>{preview.name}</b>
                <AudioPlayerCard src={preview.url} autoPlay />
              </div>
            )}
            {/* 3D:url 是模型文件（下载按钮的目标），展示层用预览截图；
                没有截图时给占位（交互式查看去 /three-d） */}
            {preview.kind === "3d" &&
              (preview.cover ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview.cover} alt={preview.name} />
              ) : (
                <div className="as-preview-audio">
                  <span className="as-preview-audio-ic">◇</span>
                  <b>{preview.name}</b>
                </div>
              ))}
          </div>

          {/* image-only quick actions: hand off to 创作台 */}
          {preview.kind === "image" && !pickMode && (
            <div className="as-preview-ops" onClick={(e) => e.stopPropagation()}>
              <button type="button" onClick={() => sendToStudio("pad")}>
                作为垫图
              </button>
              <button type="button" onClick={() => sendToStudio("video")}>
                生成视频
              </button>
              <button type="button" onClick={() => sendToStudio("edit")}>
                精细编辑
              </button>
            </div>
          )}

          {/* 3D:交互式旋转查看在 /three-d 工作台，带 task 深链精确落位到该模型 */}
          {preview.kind === "3d" && !pickMode && (
            <div className="as-preview-ops" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={() =>
                  router.push(preview.taskId ? `/three-d?task=${preview.taskId}` : "/three-d")
                }
              >
                在 3D 工作台查看
              </button>
            </div>
          )}
        </div>
      )}

    </main>
  );
}

/* ── TaskCard — a generation result (生成历史) over a real AiTaskVO ──────────── */

const TaskCard = memo(function TaskCard({
  task,
  pickMode,
  onPick,
  onOpen,
  batchMode,
  selected,
  onToggle,
}: {
  task: AiTaskVO;
  pickMode?: boolean;
  onPick?: (asset: PickedAsset) => void;
  onOpen?: (asset: OpenAsset) => void;
  batchMode?: boolean;
  selected?: boolean;
  onToggle?: (id: string) => void;
}) {
  const kind = HANDLER_MEDIA_KIND[task.handler] ?? "image";
  const isVid = kind === "video";
  // 3D 的 resultUrl 是模型文件,封面取 resultMeta.assets 的预览截图。
  const threeDPreview = kind === "3d" ? threeDPreviewOf(task) : undefined;
  // 3D 可打开/下载的主文件(resultUrl 缺失时回退 meta.assets,防老数据)。
  const threeDUrl = kind === "3d" ? threeDModelUrlOf(task) : undefined;
  const openUrl = kind === "3d" ? threeDUrl : task.resultUrl;
  // 卡片封面一律走降采样:原图动辄 2K~4K 几 MB,卡片才 ~340px(2x 余量取 640)。
  // 音频结果是 mp3,不能当封面图铺——改走 SongCard 歌曲行(见下)。
  const coverSource = kind === "image" ? task.resultUrl : threeDPreview;
  const coverUrl = coverSource ? (ossDisplayUrl(coverSource, 640) ?? coverSource) : undefined;
  const fallback = fallbackCover(task.id);
  // 音频分轨信息(歌名/封面/时长/地址)取自 resultMeta.tracks;Suno 一次两首,
  // 两轨都要成行,少了第二首就等于丢歌。
  const tracks = useMemo(() => tracksOf(task), [task]);
  const audioRows = useMemo(() => {
    const usable = tracks.filter((track): track is AudioTrack & { url: string } => Boolean(track.url));
    if (usable.length > 0) return usable;
    return task.resultUrl
      ? [{ url: task.resultUrl, title: task.modelName || "未命名" }]
      : [];
  }, [tracks, task.resultUrl, task.modelName]);
  // 非成功任务没有结果可看,兜底卡上标出状态,免得看起来像加载失败的空白图。
  const statusLabel =
    task.status === AiTaskStatus.PROCESSING
      ? "生成中"
      : task.status === AiTaskStatus.FAILED
        ? "失败"
        : task.status === AiTaskStatus.CANCELLED
          ? "已取消"
          : "";

  const onClick = () => {
    if (batchMode) {
      onToggle?.(String(task.id));
      return;
    }
    if (pickMode) {
      // 参考素材选取只收 image/video/audio；3D 模型文件塞不进任何参考槽位。
      if (kind === "3d") {
        toast.info("3D 模型暂不支持选为参考素材");
        return;
      }
      if (task.resultUrl) {
        onPick?.({ url: task.resultUrl, name: task.modelName || "生成图", kind });
      } else {
        toast.info("该生成暂无可选取的结果");
      }
      return;
    }
    if (openUrl) {
      onOpen?.({
        url: openUrl,
        kind,
        name: kind === "3d" ? threeDDownloadName(task, openUrl) : task.modelName || "生成结果",
        ...(kind === "3d"
          ? { taskId: String(task.id), ...(threeDPreview ? { cover: threeDPreview } : {}) }
          : {}),
      });
    } else {
      toast.info("该生成暂无可预览的结果");
    }
  };

  // 音频:方形卡片换成 SongCard 歌曲行(封面+歌名+波形+时间,整行即播放器);
  // Suno 一次两首按分轨逐行铺开;批量/选取走行上角标,行内 sc-row 自己拦截
  // 点击用于播放。
  if (kind === "audio" && audioRows.length > 0) {
    return (
      <div className="as-songrow">
        {audioRows.map((t, i) => (
          <SongCard
            key={t.url ?? i}
            src={t.url}
            title={t.title || task.modelName || "未命名"}
            subtitle={task.modelName}
            cover={t.coverUrl}
            duration={t.duration}
          />
        ))}
        {batchMode && (
          <button
            type="button"
            className="as-songrow-select"
            aria-label={selected ? "取消选择该音频" : "选择该音频"}
            aria-pressed={!!selected}
            onClick={() => onToggle?.(String(task.id))}
          >
            <SelectBadge selected={!!selected} />
          </button>
        )}
        {pickMode && (
          <button
            type="button"
            className="as-songrow-pick"
            onClick={() => onPick?.({ url: audioRows[0].url, name: audioRows[0].title || "生成音乐", kind })}
          >
            选取
          </button>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      className="as-card"
      style={{
        outline: selected ? "3px solid var(--accent, #7c8cff)" : undefined,
        outlineOffset: -3,
      }}
      title={task.modelName}
      aria-label={`${batchMode ? selected ? "取消选择" : "选择" : pickMode ? "选取" : "打开"}${task.modelName || "生成结果"}`}
      onClick={onClick}
    >
      {/* 视频:背景图铺不了 mp4(浏览器不渲染),用 video 首帧做卡片视觉 */}
      {isVid && task.resultUrl ? (
        <LazyVideoCover src={task.resultUrl} fallback={fallback} />
      ) : coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="cov"
          src={coverUrl}
          alt=""
          loading="lazy"
          decoding="async"
          onLoad={(event) => restoreOssDisplayImage(event.currentTarget)}
          onError={(event) => fallbackOssDisplayImage(event.currentTarget, coverSource)}
        />
      ) : (
        <span className="cov" style={{ background: fallback }} />
      )}
      {pickMode && <span className="pick" />}
      {batchMode && <SelectBadge selected={!!selected} />}
      {!!task.resultUrl && isVid && <span className="vbadge">▶</span>}
      {!!task.resultUrl && kind === "audio" && <span className="vbadge">♪</span>}
      {!!threeDUrl && kind === "3d" && <span className="vbadge">◇</span>}
      {statusLabel && <span className="as-status">{statusLabel}</span>}
    </button>
  );
});

function LazyVideoCover({ src, fallback }: { src: string; fallback?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || visible) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setVisible(true);
        observer.disconnect();
      },
      { rootMargin: "240px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible]);

  return (
    <video
      ref={ref}
      className="cov as-vid"
      muted
      playsInline
      preload={visible ? "metadata" : "none"}
      src={visible ? src : undefined}
      style={{ background: fallback }}
    />
  );
}

/** 多选模式下的勾选角标(内联样式,免额外 CSS)。 */
function SelectBadge({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden
      style={{
        position: "absolute",
        top: 8,
        left: 8,
        width: 22,
        height: 22,
        borderRadius: "50%",
        display: "grid",
        placeItems: "center",
        fontSize: 13,
        fontWeight: 800,
        color: selected ? "#fff" : "transparent",
        background: selected ? "var(--accent, #7c8cff)" : "rgba(0,0,0,0.35)",
        border: "2px solid #fff",
        zIndex: 3,
      }}
    >
      ✓
    </span>
  );
}

/* ── UploadCard — an uploaded file (上传历史) over a real FileVO ─────────────── */

const UploadCard = memo(function UploadCard({
  file,
  pickMode,
  onPick,
  onOpen,
  batchMode,
  selected,
  onToggle,
}: {
  file: FileVO;
  pickMode?: boolean;
  onPick?: (asset: PickedAsset) => void;
  onOpen?: (asset: OpenAsset) => void;
  batchMode?: boolean;
  selected?: boolean;
  onToggle?: (id: string) => void;
}) {
  const kind = fileMediaKind(file);
  const isImg = kind === "image";

  const onClick = () => {
    if (batchMode) {
      onToggle?.(String(file.id));
      return;
    }
    if (pickMode) {
      if (file.fileUrl) {
        onPick?.({ url: file.fileUrl, name: file.originalName || "文件", kind });
      } else {
        toast.info("该文件暂无可选取的内容");
      }
      return;
    }
    if (file.fileUrl) {
      onOpen?.({ url: file.fileUrl, kind, name: file.originalName || "文件" });
    } else {
      toast.info("该文件暂无可预览的内容");
    }
  };

  // 音频:方形卡片换成 SongCard 歌曲行(与生成历史同形态)。
  if (kind === "audio" && file.fileUrl) {
    return (
      <div className="as-songrow">
        <SongCard
          src={file.fileUrl}
          title={file.originalName || "未命名"}
          subtitle={`上传 · ${fmtSize(file.fileSize)}`}
        />
        {batchMode && (
          <button
            type="button"
            className="as-songrow-select"
            aria-label={selected ? "取消选择该音频" : "选择该音频"}
            aria-pressed={!!selected}
            onClick={() => onToggle?.(String(file.id))}
          >
            <SelectBadge selected={!!selected} />
          </button>
        )}
        {pickMode && (
          <button
            type="button"
            className="as-songrow-pick"
            onClick={() => onPick?.({ url: file.fileUrl!, name: file.originalName || "音频", kind })}
          >
            选取
          </button>
        )}
      </div>
    );
  }

  return (
    <button
      type="button"
      className="as-card as-up"
      style={{
        outline: selected ? "3px solid var(--accent, #7c8cff)" : undefined,
        outlineOffset: -3,
      }}
      title={file.originalName}
      aria-label={`${batchMode ? selected ? "取消选择" : "选择" : pickMode ? "选取" : "打开"}${file.originalName || "文件"}`}
      onClick={onClick}
    >
      {batchMode && <SelectBadge selected={!!selected} />}
      {isImg && file.fileUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="cov"
          src={ossDisplayUrl(file.fileUrl, 640) ?? file.fileUrl}
          alt=""
          loading="lazy"
          decoding="async"
          onLoad={(event) => restoreOssDisplayImage(event.currentTarget)}
          onError={(event) => fallbackOssDisplayImage(event.currentTarget, file.fileUrl)}
        />
      ) : kind === "video" && file.fileUrl ? (
        // 视频:video 首帧做卡片视觉(背景图铺不了 mp4),配 ▶ 角标
        <>
          <LazyVideoCover src={file.fileUrl} fallback={fallbackCover(file.id)} />
          <span className="vbadge">▶</span>
        </>
      ) : (
        <span className="cov as-file">
          <span className="as-file-ic">{FILE_GLYPH[kind] || "▤"}</span>
        </span>
      )}
      {pickMode && <span className="pick" />}
      <span className="as-up-badge">
        {file.category === FileCategory.CHARACTER
          ? "角色"
          : file.category === FileCategory.SCENE
            ? "场景"
            : "↑ 上传"}
      </span>
      <span className="as-meta">
        <b>{file.originalName}</b>
        <i>{fmtSize(file.fileSize)}</i>
      </span>
    </button>
  );
});
