"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import {
  ArrowLeft,
  Box,
  ChevronDown,
  FileText,
  Image as ImageIcon,
  Music,
  Play,
  RefreshCw,
  Search,
  Video,
} from "lucide-react";
import { Logo } from "@/components/flux/atoms";
import {
  AdminAlert,
  AdminDrawer,
  AdminEmptyState,
  AdminTable,
  Panel,
  StatusPill,
  TableSkeleton,
  type Column,
  type StatusPillProps,
} from "@/components/admin";
import { aiApi } from "@/lib/api";
import { useAuthStore } from "@/stores/use-auth-store";
import type {
  UserGenerationHistoryDetailVO,
  UserGenerationHistoryVO,
  UserHistoryAssetVO,
} from "@/types/ai";

type PillTone = StatusPillProps["tone"];
type MediaFilter = "" | "image" | "video" | "audio" | "3d" | "text";

type ResultAsset = UserHistoryAssetVO;
type InputAsset = UserHistoryAssetVO;

const INPUT_ASSET_PREVIEW_LIMIT = 8;

const INPUT_ASSET_GROUPS: Array<{
  kind: InputAsset["kind"];
  label: string;
}> = [
  { kind: "image", label: "图片" },
  { kind: "video", label: "视频" },
  { kind: "audio", label: "音频" },
  { kind: "file", label: "文件" },
];

const TYPE_OPTIONS: Array<{ label: string; value: MediaFilter }> = [
  { label: "全部", value: "" },
  { label: "图片", value: "image" },
  { label: "视频", value: "video" },
  { label: "音频", value: "audio" },
  { label: "3D", value: "3d" },
  { label: "文本", value: "text" },
];

const STATUS_OPTIONS = ["全部", "成功", "失败"] as const;

const PARAM_LABEL: Record<string, string> = {
  ratio: "画面比例",
  aspectRatio: "画面比例",
  aspect_ratio: "画面比例",
  resolution: "分辨率",
  targetResolution: "目标分辨率",
  target_resolution: "目标分辨率",
  duration: "时长",
  count: "生成数量",
  size: "尺寸",
  quality: "质量",
  fps: "帧率",
  seed: "随机种子",
  style: "风格",
  cameraFixed: "固定镜头",
  camera_fixed: "固定镜头",
  width: "宽度",
  height: "高度",
  steps: "生成步数",
  cfgScale: "引导强度",
  outputFormat: "输出格式",
};

function kindForUrl(url: string, fallback: ResultAsset["kind"] = "image"): ResultAsset["kind"] {
  const clean = url.split(/[?#]/, 1)[0].toLowerCase();
  if (/\.(mp4|mov|webm)$/.test(clean)) return "video";
  if (/\.(mp3|wav|m4a|ogg|aac|flac)$/.test(clean)) return "audio";
  if (/\.(png|jpe?g|webp|gif|avif)$/.test(clean)) return "image";
  if (/\.(glb|gltf|obj|fbx|stl|zip)$/.test(clean)) return "file";
  return fallback;
}

function sceneLabel(row: Pick<UserGenerationHistoryVO, "mediaType">): string {
  return TYPE_OPTIONS.find((item) => item.value === row.mediaType)?.label || "其他";
}

function sceneTone(row: Pick<UserGenerationHistoryVO, "mediaType">): PillTone {
  switch (row.mediaType) {
    case "video": return "green";
    case "image": return "blue";
    case "audio": return "amber";
    default: return "gray";
  }
}

function fmtTime(value: string): string {
  if (!value) return "—";
  const time = Date.parse(value);
  if (Number.isNaN(time)) return value;
  const date = new Date(time);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function duration(ms: number): string {
  if (!ms || ms <= 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}秒`;
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}分${seconds % 60}秒`;
}

function promptForRow(row: UserGenerationHistoryVO): string {
  return row.prompt || "";
}

function Trunc({ text }: { text: string }) {
  if (!text) return <>—</>;
  return <span className="truncate" title={text}>{text}</span>;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="genr-sec-t">{children}</h3>;
}

function AssetIcon({ kind }: { kind: ResultAsset["kind"] }) {
  if (kind === "video") return <Video aria-hidden size={14} />;
  if (kind === "audio") return <Music aria-hidden size={14} />;
  if (kind === "image") return <ImageIcon aria-hidden size={14} />;
  return <FileText aria-hidden size={14} />;
}

function ResultBlock({ detail, row }: { detail: UserGenerationHistoryDetailVO | null; row: UserGenerationHistoryVO }) {
  const fallbackKind: ResultAsset["kind"] = row.mediaType === "video"
    ? "video"
    : row.mediaType === "audio"
      ? "audio"
      : row.mediaType === "image"
        ? "image"
        : "file";
  const assets = detail?.resultAssets.length
    ? detail.resultAssets
    : row.resultUrl
      ? [{ url: row.resultUrl, kind: kindForUrl(row.resultUrl, fallbackKind) }]
      : [];
  const reply = detail?.resultText || "";
  if (assets.length > 0) {
    return (
      <div className="user-history-result-list">
        {assets.map((asset, index) => (
          <div className="user-history-result" key={asset.url}>
            {asset.kind === "video" ? (
              <video controls preload="metadata" src={asset.url} />
            ) : asset.kind === "audio" ? (
              <audio aria-label={asset.name || `生成音频 ${index + 1}`} controls preload="metadata" src={asset.url} />
            ) : asset.kind === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={asset.url} alt={asset.name || `生成结果 ${index + 1}`} loading="lazy" />
            ) : (
              <div className="genr-media-empty">
                <Box aria-hidden size={24} style={{ margin: "0 auto 8px" }} />
                {asset.name ? `${asset.name} 文件` : "生成文件"}
              </div>
            )}
            <div className="user-history-result-meta">
              <span>{asset.name || `结果 ${index + 1}`}</span>
              <a href={asset.url} target="_blank" rel="noreferrer">打开原文件</a>
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (reply) return <pre className="genr-reply">{reply}</pre>;
  if (row.success !== 1) return <div className="user-history-error">生成未完成，本次消耗的积分已退回。</div>;
  return <div className="genr-media-empty">暂无可预览的生成结果，链接可能已过期。</div>;
}

function InputBlock({ assets }: { assets: InputAsset[] }) {
  if (assets.length === 0) return <div className="genr-media-empty">无输入素材</div>;
  return (
    <div className="user-history-input-groups">
      {INPUT_ASSET_GROUPS.map((group) => {
        const groupAssets = assets.filter((asset) => asset.kind === group.kind);
        return groupAssets.length > 0 ? (
          <InputAssetGroup key={group.kind} kind={group.kind} label={group.label} assets={groupAssets} />
        ) : null;
      })}
    </div>
  );
}

function InputAssetGroup({
  kind,
  label,
  assets,
}: {
  kind: InputAsset["kind"];
  label: string;
  assets: InputAsset[];
}) {
  const [expanded, setExpanded] = useState(false);
  const canExpand = assets.length > INPUT_ASSET_PREVIEW_LIMIT;
  const visibleAssets = expanded ? assets : assets.slice(0, INPUT_ASSET_PREVIEW_LIMIT);

  return (
    <div className="user-history-input-group">
      <div className="user-history-input-group-head">
        <span>{label}</span>
        <span className="user-history-input-count">{assets.length}</span>
      </div>

      <div className={`user-history-input-grid${kind === "audio" || kind === "file" ? " is-file-list" : ""}`}>
        {visibleAssets.map((asset, index) => kind === "image" ? (
          <a
            className="user-history-input-card"
            key={asset.url}
            href={asset.url}
            target="_blank"
            rel="noreferrer"
            title={asset.name || `打开图片 ${index + 1}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={asset.url} alt={asset.name || `输入图片 ${index + 1}`} loading="lazy" />
            <span className="user-history-input-card-label">图片 {index + 1}</span>
          </a>
        ) : kind === "video" ? (
          <a
            className="user-history-input-card is-video"
            key={asset.url}
            href={asset.url}
            target="_blank"
            rel="noreferrer"
            title={asset.name || `打开视频 ${index + 1}`}
          >
            <video src={asset.url} muted playsInline preload="metadata" aria-label={asset.name || `输入视频 ${index + 1}`} />
            <span className="user-history-input-play" aria-hidden><Play size={15} fill="currentColor" /></span>
            <span className="user-history-input-card-label">视频 {index + 1}</span>
          </a>
        ) : (
          <a
            className="genr-file user-history-input-link"
            key={asset.url}
            href={asset.url}
            target="_blank"
            rel="noreferrer"
            title={asset.name || asset.url}
          >
            <AssetIcon kind={asset.kind} />
            <span>{asset.name || `${label} ${index + 1}`}</span>
          </a>
        ))}
      </div>

      {canExpand ? (
        <button
          type="button"
          className="user-history-input-expand"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <ChevronDown aria-hidden size={14} />
          {expanded ? "收起" : `展开其余 ${assets.length - INPUT_ASSET_PREVIEW_LIMIT} 个`}
        </button>
      ) : null}
    </div>
  );
}

function DetailDrawer({ row, onClose }: { row: UserGenerationHistoryVO; onClose: () => void }) {
  const ensureSession = useAuthStore((state) => state.ensureSession);
  const [detail, setDetail] = useState<UserGenerationHistoryDetailVO | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const ok = await ensureSession();
      if (!ok) return;
      const response = await aiApi.myHistoryDetail(row.id);
      if (!alive) return;
      if (response.success && response.data) {
        setDetail(response.data);
      } else {
        setError(response.code === 404 ? "这条记录已不可用。" : "暂时无法加载详情，请稍后重试。");
      }
      setLoaded(true);
    })();
    return () => { alive = false; };
  }, [ensureSession, row.id]);

  const prompt = detail?.prompt || row.prompt;
  const params = detail?.parameters || [];
  const success = row.success === 1;
  const pointCost = detail?.pointCost ?? row.pointCost;

  return (
    <AdminDrawer
      open
      title="生成记录详情"
      extra={<StatusPill tone={success ? "green" : "red"}>{success ? "成功" : "失败"}</StatusPill>}
      onClose={onClose}
    >
      {error ? (
        <AdminAlert tone="error" title="详情加载失败">{error}</AdminAlert>
      ) : !loaded ? (
        <div aria-busy="true">
          <span className="sr-only" role="status">正在加载详情</span>
          <div className="skel" style={{ height: 14, width: "38%", borderRadius: 4 }} />
          <div className="skel" style={{ height: 200, borderRadius: 8, marginTop: 16 }} />
          <div className="skel" style={{ height: 88, borderRadius: 8, marginTop: 16 }} />
        </div>
      ) : (
        <>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <StatusPill tone={sceneTone(row)}>{sceneLabel(row)}</StatusPill>
              <span className="strong" style={{ fontSize: 15, wordBreak: "break-all" }}>{detail?.model || row.model || "—"}</span>
            </div>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>{fmtTime(row.createTime)}</div>
          </div>

          <section>
            <SectionTitle>生成结果</SectionTitle>
            <ResultBlock detail={detail} row={row} />
          </section>

          <section>
            <SectionTitle>生成参数</SectionTitle>
            <div className="genr-grid">
              {params.map((param) => (
                <div className="genr-cell" key={param.key}>
                  <div className="k">{PARAM_LABEL[param.key] || param.key}</div>
                  <div className="v">{param.value}</div>
                </div>
              ))}
              <div className="genr-cell">
                <div className="k">平台积分消耗</div>
                <div className="v">{pointCost == null ? "—" : success ? pointCost : `${pointCost}（已退款）`}</div>
              </div>
              <div className="genr-cell">
                <div className="k">耗时</div>
                <div className="v">{duration(row.durationMs)}</div>
              </div>
            </div>
          </section>

          <section>
            <SectionTitle>输入素材</SectionTitle>
            <InputBlock assets={detail?.inputAssets || []} />
          </section>

          <section>
            <SectionTitle>Prompt</SectionTitle>
            {prompt ? <pre className="genr-prompt">{prompt}</pre> : <div className="genr-media-empty">本次生成没有 Prompt</div>}
          </section>

        </>
      )}
    </AdminDrawer>
  );
}

export interface GenerationHistoryProps {
  mode?: "page" | "modal";
  onDetailOpenChange?: (open: boolean) => void;
}

export function GenerationHistory({ mode = "page", onDetailOpenChange }: GenerationHistoryProps) {
  const ensureSession = useAuthStore((state) => state.ensureSession);
  const [rows, setRows] = useState<UserGenerationHistoryVO[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [mediaType, setMediaType] = useState<MediaFilter>("");
  const [status, setStatus] = useState<(typeof STATUS_OPTIONS)[number]>("全部");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<UserGenerationHistoryVO | null>(null);
  const requestId = useRef(0);
  const PAGE_SIZE = 20;

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    const ok = await ensureSession();
    if (!ok) return;
    const response = await aiApi.myHistory({
      pageNum: page,
      pageSize: PAGE_SIZE,
      keyword: keyword.trim() || undefined,
      mediaType: mediaType || undefined,
      success: status === "成功" ? 1 : status === "失败" ? 0 : undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    });
    if (id !== requestId.current) return;
    if (response.success && response.data) {
      setRows(response.data.records);
      setTotal(response.data.total);
    } else {
      setRows([]);
      setTotal(0);
      setError("暂时无法加载生成记录，请稍后重试。");
    }
    setLoading(false);
  }, [ensureSession, endDate, keyword, mediaType, page, startDate, status]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 300);
    return () => window.clearTimeout(timer);
  }, [load]);

  const applyFilter = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setPage(1);
  };

  const openDetail = useCallback((row: UserGenerationHistoryVO) => {
    setDetail(row);
    onDetailOpenChange?.(true);
  }, [onDetailOpenChange]);

  const closeDetail = useCallback(() => {
    setDetail(null);
    onDetailOpenChange?.(false);
  }, [onDetailOpenChange]);

  const columns: Column<UserGenerationHistoryVO>[] = useMemo(() => [
    {
      header: "#",
      width: 48,
      className: "mono muted",
      cell: (_row, index) => (page - 1) * PAGE_SIZE + index + 1,
    },
    {
      header: "类型",
      width: 92,
      cell: (row) => <StatusPill tone={sceneTone(row)}>{sceneLabel(row)}</StatusPill>,
    },
    {
      header: "模型",
      width: 210,
      className: "strong",
      cell: (row) => <Trunc text={row.model} />,
    },
    {
      header: "Prompt",
      className: "muted",
      cell: (row) => <Trunc text={promptForRow(row)} />,
    },
    {
      header: "状态",
      width: 76,
      cell: (row) => <StatusPill tone={row.success === 1 ? "green" : "red"}>{row.success === 1 ? "成功" : "失败"}</StatusPill>,
    },
    {
      header: "平台积分",
      width: 84,
      align: "right",
      className: "mono",
      cell: (row) => row.success === 1 && row.pointCost != null ? row.pointCost : "—",
    },
    {
      header: "耗时",
      width: 96,
      align: "right",
      className: "mono muted",
      cell: (row) => duration(row.durationMs),
    },
    {
      header: "创建时间",
      width: 190,
      className: "mono muted",
      cell: (row) => fmtTime(row.createTime),
    },
    {
      header: "操作",
      width: 88,
      align: "right",
      cell: (row) => <button type="button" className="adm-btn ghost" aria-label={`查看 ${row.model || "该模型"} 的生成记录详情`} onClick={() => openDetail(row)}>详情</button>,
    },
  ], [openDetail, page]);

  const hasFilter = Boolean(keyword.trim() || mediaType || status !== "全部" || startDate || endDate);
  const detailDrawer = detail && typeof document !== "undefined"
    ? createPortal(
      <div className={`admin-body user-history-detail-portal ${GeistSans.variable} ${GeistMono.variable}`}>
        <DetailDrawer key={detail.id} row={detail} onClose={closeDetail} />
      </div>,
      document.body,
    )
    : null;

  useEffect(() => {
    return () => onDetailOpenChange?.(false);
  }, [onDetailOpenChange]);

  const records = (
    <div className="adm-page">
      <Panel
        className="user-history-panel"
        title={mode === "modal" ? "全部记录" : "生成记录"}
        sub={loading && rows.length === 0 ? "正在加载记录…" : `共 ${total.toLocaleString()} 条记录`}
        tools={(
          <>
            <div className="adm-search" role="search">
              <Search aria-hidden size={15} />
              <input
                aria-label="搜索 Prompt 或模型"
                placeholder="搜索 Prompt / 模型关键词"
                value={keyword}
                onChange={(event) => applyFilter(setKeyword)(event.target.value)}
              />
            </div>
            <button type="button" className="adm-btn ghost" onClick={() => void load()}>
              <RefreshCw aria-hidden size={15} />
              刷新
            </button>
          </>
        )}
      >
        <div className="adm-filter-row">
          <select
            className="genr-select"
            aria-label="类型筛选"
            value={mediaType}
            onChange={(event) => applyFilter(setMediaType)(event.target.value as MediaFilter)}
          >
            {TYPE_OPTIONS.map((option) => (
              <option key={option.value || "all"} value={option.value}>{option.value ? option.label : "类型：全部"}</option>
            ))}
          </select>
          <select
            className="genr-select"
            aria-label="状态筛选"
            value={status}
            onChange={(event) => applyFilter(setStatus)(event.target.value as (typeof STATUS_OPTIONS)[number])}
          >
            {STATUS_OPTIONS.map((option) => <option key={option} value={option}>{option === "全部" ? "状态：全部" : option}</option>)}
          </select>
          <input
            type="date"
            className="genr-date"
            aria-label="开始日期"
            value={startDate}
            onChange={(event) => applyFilter(setStartDate)(event.target.value)}
          />
          <span className="muted" style={{ fontSize: 12 }}>至</span>
          <input
            type="date"
            className="genr-date"
            aria-label="结束日期"
            value={endDate}
            onChange={(event) => applyFilter(setEndDate)(event.target.value)}
          />
        </div>

        {loading ? (
          <TableSkeleton />
        ) : error ? (
          <div style={{ padding: 16 }}>
            <AdminAlert
              tone="error"
              title="生成记录加载失败"
              action={<button type="button" className="adm-btn ghost" onClick={() => void load()}><RefreshCw aria-hidden size={15} />重新加载</button>}
            >
              {error}
            </AdminAlert>
          </div>
        ) : rows.length === 0 ? (
          <AdminEmptyState
            title="没有找到生成记录"
            description={hasFilter ? "尝试清除搜索或筛选条件。" : "完成一次生成后，记录会出现在这里。"}
            action={hasFilter ? (
              <button
                type="button"
                className="adm-btn ghost"
                onClick={() => {
                  setKeyword("");
                  setMediaType("");
                  setStatus("全部");
                  setStartDate("");
                  setEndDate("");
                  setPage(1);
                }}
              >
                清除筛选
              </button>
            ) : undefined}
          />
        ) : (
          <AdminTable
            rows={rows}
            rowKey={(row) => row.id}
            columns={columns}
            label="我的生成记录"
            server={{ page, pageSize: PAGE_SIZE, total, onPage: setPage }}
          />
        )}
      </Panel>
    </div>
  );

  if (mode === "modal") {
    return (
      <>
        {records}
        {detailDrawer}
      </>
    );
  }

  return (
    <div className="user-history-shell">
      <header className="user-history-topbar">
        <div className="user-history-topbar-inner">
          <Link href="/" className="user-history-brand" aria-label="返回流光首页">
            <span className="user-history-brand-mark"><Logo size={18} /></span>
            <span>FLOWINGLIGHT</span>
          </Link>
          <Link href="/studio" className="user-history-back">
            <ArrowLeft aria-hidden size={15} />
            <span>返回创作台</span>
          </Link>
        </div>
      </header>

      <main className="user-history-main">
        <div className="user-history-heading">
          <h1>我的生成记录</h1>
          <p>仅展示当前账号发起的生成任务，包括成功结果、失败原因、耗时和积分。</p>
        </div>

        {records}
      </main>

      {detailDrawer}
    </div>
  );
}

export default GenerationHistory;
