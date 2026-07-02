"use client";

/* ============================================================================
   AssetsBrowser — the 资产 (Assets) UI, reusable as a full page (资产 route) and
   as a picker dialog (创作台 参考图「从资产库选取」). Ported from the assets page.

   - Default (browse) mode: clicking a card opens the asset in a new tab.
   - Pick mode (`onPick` set): clicking a card returns its URL to the caller and
     the card shows a 选择 affordance; the 批量操作 / 同步 actions are hidden.
   ========================================================================== */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { aiApi, fileApi, uploadFileSmart } from "@/lib/api";
import { useAuthStore } from "@/stores/use-auth-store";
import type { FileVO } from "@/types/file";
import type { AiTaskVO } from "@/types/ai";
import { mesh } from "@/lib/mesh";
import { toast } from "@/components/shared/toast";
import { useReveal } from "@/components/site/use-reveal";

type TabKey = "hist" | "upload";
type FilterKey = "image" | "video" | "audio" | "doc";

/** A picked asset handed back to the caller in pick mode. */
export interface PickedAsset {
  url: string;
  name: string;
  kind: FilterKey;
}

const TABS: { t: TabKey; label: string }[] = [
  { t: "hist", label: "生成历史" },
  { t: "upload", label: "上传历史" },
];

const FILTERS: { f: FilterKey; label: string }[] = [
  { f: "image", label: "图片" },
  { f: "video", label: "视频" },
  { f: "audio", label: "音频" },
  { f: "doc", label: "文档" },
];

/** 上传历史 filter → backend FileType (image|video|other). 音频/文档 collapse to
 *  "other"; we then split them client-side by mimeType. */
const FILTER_TO_FILETYPE: Record<FilterKey, string> = {
  image: "image",
  video: "video",
  audio: "other",
  doc: "other",
};

/** generation handler → media type, for the 生成历史 filter. */
const HANDLER_TYPE: Record<string, "image" | "video"> = {
  text_to_image: "image",
  image_to_image: "image",
  text_to_video: "video",
  image_to_video: "video",
  start_end_to_video: "video",
};

const FILE_GLYPH: Record<string, string> = { audio: "♪", doc: "▤", video: "▶" };
const ACCEPT: Record<FilterKey, string> = {
  image: "image/*",
  video: "video/*",
  audio: "audio/*",
  doc: ".pdf,.doc,.docx,.txt,.md,.ppt,.pptx,.xls,.xlsx",
};

/** Deterministic mesh fallback for an item without a usable cover URL. */
function fallbackCover(seed: number): string {
  const h = (((seed * 47) % 360) + 360) % 360;
  return mesh(h, (h + 132) % 360, (h + 248) % 360);
}

/** createTime "YYYY-MM-DDTHH:MM:SS" → design's "M 月 D 日" header. */
function dateLabel(createTime: string): string {
  if (!createTime) return "未知日期";
  const t = Date.parse(createTime);
  if (Number.isNaN(t)) return createTime;
  const d = new Date(t);
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

function timeKey(s: string): number {
  if (!s) return 0;
  const t = Date.parse(s);
  return Number.isNaN(t) ? 0 : t;
}

function fmtSize(bytes: number): string {
  if (!bytes) return "";
  const mb = bytes / 1024 / 1024;
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** media kind of an uploaded file (image|video|audio|doc) from its type/mime. */
function fileKind(f: FileVO): FilterKey {
  if (f.fileType === "image") return "image";
  if (f.fileType === "video") return "video";
  if ((f.mimeType || "").startsWith("audio/")) return "audio";
  return "doc";
}

/** A previewable / downloadable asset surfaced from a card click. */
interface OpenAsset {
  url: string;
  kind: FilterKey;
  name: string;
}

/** Force a download through the public server proxy, which adds a
 *  Content-Disposition: attachment header (so cross-origin OSS files actually
 *  download instead of opening) and bypasses CORS. Same-origin /api path is
 *  rewritten to the backend by next.config. */
function downloadAsset(url: string, name: string): void {
  const href = `/api/files/download?url=${encodeURIComponent(url)}&name=${encodeURIComponent(name || "download")}`;
  const a = document.createElement("a");
  a.href = href;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

interface Group<T> {
  date: string;
  items: T[];
}

function groupByDate<T>(rows: T[], getTime: (r: T) => string): Group<T>[] {
  const buckets = new Map<string, T[]>();
  const order: string[] = [];
  const sorted = rows.slice().sort((a, b) => timeKey(getTime(b)) - timeKey(getTime(a)));
  for (const r of sorted) {
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
  /** initial tab — 生成历史 has no audio/doc, so audio picks should pass "upload" */
  defaultTab?: TabKey;
  /** initial media filter (image | video | audio | doc) */
  defaultFilter?: FilterKey;
}) {
  const [tab, setTab] = useState<TabKey>(defaultTab);
  const [filter, setFilter] = useState<FilterKey>(defaultFilter);
  const [tasks, setTasks] = useState<AiTaskVO[]>([]);
  const [files, setFiles] = useState<FileVO[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  // in-app preview overlay target (image/video/audio); docs never set this.
  const [preview, setPreview] = useState<OpenAsset | null>(null);
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

  // 生成历史: all of the user's generation tasks (filtered client-side by type).
  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      await ensureSession();
      const res = await aiApi.listTasks({ pageNum: 1, pageSize: 100 });
      setTasks(res.success && res.data ? res.data.records : []);
    } catch {
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }, [ensureSession]);

  // 上传历史: the user's uploaded files for the current filter.
  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      await ensureSession();
      const res = await fileApi.list({
        pageNum: 1,
        pageSize: 100,
        fileType: FILTER_TO_FILETYPE[filter] as FileVO["fileType"],
      });
      setFiles(res.success && res.data ? res.data.records : []);
    } catch {
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, [ensureSession, filter]);

  useEffect(() => {
    if (tab === "hist") loadTasks();
    else loadFiles();
  }, [tab, loadTasks, loadFiles]);

  // Escape closes the preview overlay.
  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPreview(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [preview]);

  // groupByDate returns newest-first; when sortAsc, reverse groups + items.
  const applySort = useCallback(
    <T,>(groups: Group<T>[]): Group<T>[] =>
      sortAsc
        ? groups.slice().reverse().map((g) => ({ ...g, items: g.items.slice().reverse() }))
        : groups,
    [sortAsc],
  );

  // tasks of the active media type, date-grouped (audio/doc → none for 生成历史).
  const taskGroups = useMemo(() => {
    if (tab !== "hist") return [];
    const want = filter === "image" || filter === "video" ? filter : null;
    if (!want) return [];
    const matched = tasks.filter((t) => (HANDLER_TYPE[t.handler] ?? "image") === want);
    return applySort(groupByDate(matched, (t) => t.createTime));
  }, [tab, filter, tasks, applySort]);

  // uploaded files of the active media kind, date-grouped.
  const fileGroups = useMemo(() => {
    if (tab !== "upload") return [];
    const matched = files.filter((f) => fileKind(f) === filter);
    return applySort(groupByDate(matched, (f) => f.createTime));
  }, [tab, filter, files, applySort]);

  useReveal([tab, filter, taskGroups, fileGroups]);

  const groupsEmpty = tab === "hist" ? taskGroups.length === 0 : fileGroups.length === 0;

  // 切换 tab/筛选时重置多选(条目集合已变)。
  useEffect(() => {
    setBatchMode(false);
    setSelected(new Set());
  }, [tab, filter]);

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

  // 批量删除:生成历史→cancelTask,上传历史→file delete;逐条调用现有接口。
  const batchDelete = async () => {
    if (selected.size === 0 || busy) return;
    if (!window.confirm(`确认删除所选 ${selected.size} 项？此操作不可恢复。`)) return;
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
    if (tab === "hist") await loadTasks();
    else await loadFiles();
  };

  // 批量下载:通过下载代理逐个触发(强制附件下载)。
  const batchDownload = () => {
    const urls = new Map<string, { url: string; name: string }>();
    if (tab === "hist") {
      tasks.forEach((t) => t.resultUrl && urls.set(String(t.id), { url: t.resultUrl, name: t.modelName || "生成结果" }));
    } else {
      files.forEach((f) => f.fileUrl && urls.set(String(f.id), { url: f.fileUrl, name: f.originalName || "文件" }));
    }
    let n = 0;
    selected.forEach((id) => {
      const a = urls.get(id);
      if (a) {
        downloadAsset(a.url, a.name);
        n++;
      }
    });
    if (n === 0) toast.info("所选项暂无可下载内容");
  };

  // dropzone → real upload of the picked files, then reload the upload list.
  const onPickFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setUploading(true);
    try {
      await ensureSession();
      let ok = 0;
      for (const file of Array.from(list)) {
        const res = await uploadFileSmart(file);
        if (res.success) ok++;
      }
      toast[ok > 0 ? "success" : "error"](ok > 0 ? `已上传 ${ok} 个文件` : "上传失败，请稍后重试");
      if (ok > 0) await loadFiles();
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
              onClick={() => setTab(x.t)}
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
          {tab === "upload" ? (
            <button
              type="button"
              className="pri"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? "上传中…" : "↑ 上传文件"}
            </button>
          ) : (
            !pickMode && (
              <button type="button" className="pri" onClick={() => toast.info("同步到剪映 · 原型")}>
                ⇄ 同步到剪映
              </button>
            )
          )}
        </div>
      </div>

      <div className="asset-filter" id="asset-filter">
        {FILTERS.map((x) => (
          <button
            key={x.f}
            type="button"
            className={filter === x.f ? "on" : undefined}
            onClick={() => setFilter(x.f)}
          >
            {x.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setSortAsc((v) => !v)}
          title="切换排序"
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
            <b>{uploading ? "正在上传…" : "上传本地文件"}</b>
            <i>点击选择 · 支持图片 / 视频 / 音频 / 文档</i>
          </button>
        )}

        {loading ? (
          <div className="empty" style={{ padding: "80px 0" }}>
            正在加载资产…
          </div>
        ) : groupsEmpty ? (
          <div className="empty" style={{ padding: tab === "upload" ? "60px 0" : "80px 0" }}>
            {tab === "upload"
              ? "该类型暂无上传文件 —— 从本地上传后会出现在这里 ✦"
              : "该类型暂无生成资产 —— 生成后会归档到这里 ✦"}
          </div>
        ) : tab === "hist" ? (
          taskGroups.map((g) => (
            <div className="asset-group" key={g.date}>
              <div className="asset-date">{g.date}</div>
              <div className="asset-grid">
                {g.items.map((t, i) => (
                  <TaskCard
                    key={t.id}
                    task={t}
                    delay={(i % 8) * 0.02}
                    star={i === 1 || i === 9}
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
          ))
        ) : (
          fileGroups.map((g) => (
            <div className="asset-group" key={g.date}>
              <div className="asset-date">{g.date}</div>
              <div className="asset-grid">
                {g.items.map((f, i) => (
                  <UploadCard
                    key={f.id}
                    file={f}
                    delay={(i % 8) * 0.02}
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
          ))
        )}
      </div>

      {/* in-app preview overlay — image / video / audio; backdrop / ✕ / Esc closes */}
      {preview && (
        <div className="as-preview" onClick={() => setPreview(null)}>
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
                <audio src={preview.url} controls autoPlay />
              </div>
            )}
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
        </div>
      )}
    </main>
  );
}

/* ── TaskCard — a generation result (生成历史) over a real AiTaskVO ──────────── */

function TaskCard({
  task,
  delay,
  star,
  pickMode,
  onPick,
  onOpen,
  batchMode,
  selected,
  onToggle,
}: {
  task: AiTaskVO;
  delay: number;
  star: boolean;
  pickMode?: boolean;
  onPick?: (asset: PickedAsset) => void;
  onOpen?: (asset: OpenAsset) => void;
  batchMode?: boolean;
  selected?: boolean;
  onToggle?: (id: string) => void;
}) {
  const isVid = (HANDLER_TYPE[task.handler] ?? "image") === "video";
  const cover = task.resultUrl
    ? `center / cover no-repeat url("${task.resultUrl}")`
    : fallbackCover(task.id);

  const onClick = () => {
    if (batchMode) {
      onToggle?.(String(task.id));
      return;
    }
    if (pickMode) {
      if (task.resultUrl) {
        onPick?.({ url: task.resultUrl, name: task.modelName || "生成图", kind: isVid ? "video" : "image" });
      } else {
        toast.info("该生成暂无可选取的结果");
      }
      return;
    }
    if (task.resultUrl) {
      onOpen?.({ url: task.resultUrl, kind: isVid ? "video" : "image", name: task.modelName || "生成结果" });
    } else {
      toast.info("该生成暂无可预览的结果");
    }
  };

  return (
    <button
      type="button"
      className="as-card reveal in"
      style={{
        ["--rd" as string]: `${delay}s`,
        outline: selected ? "3px solid var(--accent, #7c8cff)" : undefined,
        outlineOffset: -3,
      }}
      title={task.modelName}
      onClick={onClick}
    >
      <span className="cov" style={{ background: cover }} />
      <span className="pick" />
      {batchMode && <SelectBadge selected={!!selected} />}
      {star && <span className="star">★</span>}
      {isVid && <span className="vbadge">▶</span>}
    </button>
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

function UploadCard({
  file,
  delay,
  pickMode,
  onPick,
  onOpen,
  batchMode,
  selected,
  onToggle,
}: {
  file: FileVO;
  delay: number;
  pickMode?: boolean;
  onPick?: (asset: PickedAsset) => void;
  onOpen?: (asset: OpenAsset) => void;
  batchMode?: boolean;
  selected?: boolean;
  onToggle?: (id: string) => void;
}) {
  const kind = fileKind(file);
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

  return (
    <button
      type="button"
      className="as-card as-up reveal in"
      style={{
        ["--rd" as string]: `${delay}s`,
        outline: selected ? "3px solid var(--accent, #7c8cff)" : undefined,
        outlineOffset: -3,
      }}
      title={file.originalName}
      onClick={onClick}
    >
      {batchMode && <SelectBadge selected={!!selected} />}
      {isImg && file.fileUrl ? (
        <span
          className="cov"
          style={{ background: `center / cover no-repeat url("${file.fileUrl}")` }}
        />
      ) : (
        <span className="cov as-file">
          <span className="as-file-ic">{FILE_GLYPH[kind] || "▤"}</span>
        </span>
      )}
      <span className="pick" />
      <span className="as-up-badge">↑ 上传</span>
      <span className="as-meta">
        <b>{file.originalName}</b>
        <i>{fmtSize(file.fileSize)}</i>
      </span>
    </button>
  );
}
