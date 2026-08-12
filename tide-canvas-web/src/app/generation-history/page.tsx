"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Box,
  FileText,
  Image as ImageIcon,
  Music,
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
import type { AiGenerationLogVO, AiTaskVO } from "@/types/ai";

type PillTone = StatusPillProps["tone"];
type MediaFilter = "" | "image" | "video" | "audio" | "3d" | "text";

interface ResultAsset {
  url: string;
  kind: "image" | "video" | "audio" | "file";
  name?: string;
}

type InputAsset = ResultAsset;

const TYPE_OPTIONS: Array<{ label: string; value: MediaFilter }> = [
  { label: "全部", value: "" },
  { label: "图片", value: "image" },
  { label: "视频", value: "video" },
  { label: "音频", value: "audio" },
  { label: "3D", value: "3d" },
  { label: "文本", value: "text" },
];

const STATUS_OPTIONS = ["全部", "成功", "失败"] as const;

const OP_LABEL: Record<string, string> = {
  generation: "图片",
  edits: "图片",
  video: "视频",
  audio: "音频",
  "3d": "3D",
  upscale: "视频",
  chat: "文本",
  text: "文本",
};

const PARAM_LABEL: Record<string, string> = {
  model: "模型",
  prompt: "Prompt",
  ratio: "画面比例",
  aspectRatio: "画面比例",
  resolution: "分辨率",
  duration: "时长",
  count: "生成数量",
  size: "尺寸",
  quality: "质量",
  fps: "帧率",
  seed: "随机种子",
  style: "风格",
  cameraFixed: "固定镜头",
};

const PARAM_DENY = new Set([
  "prompt",
  "model",
  "systemPrompt",
  "system_prompt",
  "clientRequestId",
  "toolKey",
  "sourceImage",
  "firstFrame",
  "lastFrame",
  "references",
  "videoReferences",
  "audioReferences",
  "imageUrls",
  "videoUrls",
  "audioUrls",
  "messages",
  "files",
]);

function parseObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return {};
}

function isHttpUrl(value: unknown): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim());
}

function kindForUrl(url: string, fallback: ResultAsset["kind"] = "image"): ResultAsset["kind"] {
  const clean = url.split(/[?#]/, 1)[0].toLowerCase();
  if (/\.(mp4|mov|webm)$/.test(clean)) return "video";
  if (/\.(mp3|wav|m4a|ogg|aac|flac)$/.test(clean)) return "audio";
  if (/\.(png|jpe?g|webp|gif|avif)$/.test(clean)) return "image";
  if (/\.(glb|gltf|obj|fbx|stl|zip)$/.test(clean)) return "file";
  return fallback;
}

function uniqueAssets(assets: ResultAsset[]): ResultAsset[] {
  const seen = new Set<string>();
  return assets.filter((asset) => {
    if (!asset.url || seen.has(asset.url)) return false;
    seen.add(asset.url);
    return true;
  });
}

function resultAssets(task: AiTaskVO): ResultAsset[] {
  const meta = parseObject(task.resultMeta);
  const fallback = sceneKey(task.handler, "") === "video"
    ? "video"
    : sceneKey(task.handler, "") === "audio"
      ? "audio"
      : sceneKey(task.handler, "") === "3d"
        ? "file"
        : "image";
  const out: ResultAsset[] = [];

  const tracks = Array.isArray(meta.tracks) ? meta.tracks : [];
  for (const raw of tracks) {
    const track = parseObject(raw);
    if (isHttpUrl(track.url)) {
      out.push({ url: track.url, kind: "audio", name: typeof track.title === "string" ? track.title : undefined });
    }
  }

  const assets = Array.isArray(meta.assets) ? meta.assets : [];
  for (const raw of assets) {
    const asset = parseObject(raw);
    if (isHttpUrl(asset.url)) {
      const type = typeof asset.type === "string" ? asset.type.toUpperCase() : undefined;
      out.push({ url: asset.url, kind: "file", name: type });
    }
  }

  const urls = Array.isArray(meta.urls) ? meta.urls : [];
  for (const url of urls) {
    if (isHttpUrl(url)) out.push({ url, kind: kindForUrl(url, fallback) });
  }
  if (isHttpUrl(task.resultUrl)) out.push({ url: task.resultUrl, kind: kindForUrl(task.resultUrl, fallback) });
  return uniqueAssets(out);
}

function inputAssets(input: Record<string, unknown>): InputAsset[] {
  const out: InputAsset[] = [];
  const walk = (value: unknown, key = "") => {
    if (isHttpUrl(value)) {
      const hint = key.toLowerCase();
      const fallback = hint.includes("video") ? "video" : hint.includes("audio") ? "audio" : "image";
      out.push({ url: value, kind: kindForUrl(value, fallback) });
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item) => walk(item, key));
      return;
    }
    if (value && typeof value === "object") {
      Object.entries(value as Record<string, unknown>).forEach(([childKey, child]) => walk(child, childKey));
    }
  };
  walk(input);
  return uniqueAssets(out);
}

function sceneKey(handler: string, operation: string): MediaFilter {
  if (handler === "text_to_audio" || operation === "audio") return "audio";
  if (handler === "generate_3d" || operation === "3d") return "3d";
  if (handler === "assistant_chat" || handler === "skill_text_completion" || operation === "chat" || operation === "text") return "text";
  if (handler.includes("video") || operation === "video" || operation === "upscale") return "video";
  return "image";
}

function sceneLabel(row: Pick<AiGenerationLogVO, "handlerName" | "operationType">): string {
  return OP_LABEL[row.operationType] || TYPE_OPTIONS.find((item) => item.value === sceneKey(row.handlerName, row.operationType))?.label || "其他";
}

function sceneTone(row: Pick<AiGenerationLogVO, "handlerName" | "operationType">): PillTone {
  switch (sceneKey(row.handlerName, row.operationType)) {
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

function promptOf(input: Record<string, unknown>): string {
  for (const key of ["prompt", "text", "description", "lyrics"]) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  const messages = Array.isArray(input.messages) ? input.messages : [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = parseObject(messages[i]);
    if (message.role !== "user") continue;
    if (typeof message.content === "string") return message.content;
  }
  return "";
}

function promptForRow(row: AiGenerationLogVO): string {
  return row.prompt || "";
}

function displayValue(value: unknown): string | null {
  if (typeof value === "string") {
    const text = value.trim();
    return text && !/^https?:\/\//i.test(text) ? text : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "boolean") return value ? "是" : "否";
  return null;
}

function parameterEntries(input: Record<string, unknown>): Array<{ key: string; value: string }> {
  const entries: Array<{ key: string; value: string }> = [];
  const push = (key: string, value: unknown) => {
    if (PARAM_DENY.has(key) || entries.length >= 18) return;
    const text = displayValue(value);
    if (!text || text.length > 80) return;
    entries.push({ key: PARAM_LABEL[key] || key, value: text });
  };
  Object.entries(input).sort(([a], [b]) => a.localeCompare(b)).forEach(([key, value]) => {
    if (value && typeof value === "object" && !Array.isArray(value) && key === "extras") {
      Object.entries(value as Record<string, unknown>).forEach(([childKey, child]) => push(childKey, child));
    } else {
      push(key, value);
    }
  });
  return entries;
}

function textReply(task: AiTaskVO): string {
  const meta = parseObject(task.resultMeta);
  return typeof meta.text === "string" ? meta.text : "";
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

function ResultBlock({ task, row, success, errorMsg }: { task: AiTaskVO | null; row: AiGenerationLogVO; success: boolean; errorMsg: string }) {
  const assets = task
    ? resultAssets(task)
    : isHttpUrl(row.resultUrl)
      ? [{ url: row.resultUrl, kind: kindForUrl(row.resultUrl, sceneKey(row.handlerName, row.operationType) === "video" ? "video" : sceneKey(row.handlerName, row.operationType) === "audio" ? "audio" : sceneKey(row.handlerName, row.operationType) === "3d" ? "file" : "image") }]
      : [];
  const reply = task ? textReply(task) : "";
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
  if (!success && errorMsg) return <div className="user-history-error">{errorMsg}</div>;
  return <div className="genr-media-empty">暂无可预览的生成结果，链接可能已过期。</div>;
}

function InputBlock({ input }: { input: Record<string, unknown> }) {
  const assets = inputAssets(input);
  if (assets.length === 0) return <div className="genr-media-empty">无输入素材</div>;
  return (
    <div className="genr-assets">
      {assets.map((asset, index) => asset.kind === "image" ? (
        <a className="user-history-input-link" key={asset.url} href={asset.url} target="_blank" rel="noreferrer" title="打开输入素材">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="thumb" src={asset.url} alt={`输入素材 ${index + 1}`} loading="lazy" />
        </a>
      ) : (
        <a className="genr-file user-history-input-link" key={asset.url} href={asset.url} target="_blank" rel="noreferrer">
          <AssetIcon kind={asset.kind} />
          <span>输入素材 {index + 1}</span>
        </a>
      ))}
    </div>
  );
}

function DetailDrawer({ row, onClose }: { row: AiGenerationLogVO; onClose: () => void }) {
  const ensureSession = useAuthStore((state) => state.ensureSession);
  const [task, setTask] = useState<AiTaskVO | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const ok = await ensureSession();
      if (!ok) return;
      const response = await aiApi.getTask(row.taskId);
      if (!alive) return;
      if (response.success && response.data) {
        setTask(response.data);
      } else if (response.code !== 404) {
        setError(response.message || "加载详情失败");
      }
      setLoaded(true);
    })();
    return () => { alive = false; };
  }, [ensureSession, row.taskId]);

  const input = task ? parseObject(task.input) : {};
  const prompt = task ? promptOf(input) : row.prompt;
  const params = parameterEntries(input);
  const success = row.success === 1;
  const pointCost = task?.pointCost ?? row.pointCost;

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
              <span className="strong" style={{ fontSize: 15, wordBreak: "break-all" }}>{task?.modelName || row.model || "—"}</span>
            </div>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>{fmtTime(row.createTime)}</div>
          </div>

          <section>
            <SectionTitle>生成结果</SectionTitle>
            <ResultBlock task={task} row={row} success={success} errorMsg={task?.errorMsg || row.errorMsg} />
          </section>

          <section>
            <SectionTitle>生成参数</SectionTitle>
            <div className="genr-grid">
              {params.map((param) => (
                <div className="genr-cell" key={param.key}>
                  <div className="k">{param.key}</div>
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
            {task ? <InputBlock input={input} /> : <div className="genr-media-empty">原任务已删除，输入素材不可用</div>}
          </section>

          <section>
            <SectionTitle>Prompt</SectionTitle>
            {prompt ? <pre className="genr-prompt">{prompt}</pre> : <div className="genr-media-empty">本次生成没有 Prompt</div>}
          </section>

          <section>
            <SectionTitle>任务信息</SectionTitle>
            <dl className="genr-tech">
              <div><dt>任务 ID</dt><dd className="mono">{row.taskId}</dd></div>
              <div><dt>类型</dt><dd>{sceneLabel(row)}</dd></div>
              <div><dt>处理方式</dt><dd>{row.handlerName || "—"}</dd></div>
              <div><dt>创建时间</dt><dd>{fmtTime(row.createTime)}</dd></div>
              <div><dt>完成时间</dt><dd>{task ? fmtTime(task.completeTime) : "—"}</dd></div>
              {!success && (task?.errorMsg || row.errorMsg) ? <div><dt>错误信息</dt><dd>{task?.errorMsg || row.errorMsg}</dd></div> : null}
            </dl>
          </section>
        </>
      )}
    </AdminDrawer>
  );
}

export default function GenerationHistoryPage() {
  const ensureSession = useAuthStore((state) => state.ensureSession);
  const [rows, setRows] = useState<AiGenerationLogVO[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [mediaType, setMediaType] = useState<MediaFilter>("");
  const [status, setStatus] = useState<(typeof STATUS_OPTIONS)[number]>("全部");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<AiGenerationLogVO | null>(null);
  const requestId = useRef(0);
  const PAGE_SIZE = 20;

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    const ok = await ensureSession();
    if (!ok) return;
    const response = await aiApi.myLogs({
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
      setError(response.message || "加载生成记录失败");
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

  const columns: Column<AiGenerationLogVO>[] = useMemo(() => [
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
      cell: (row) => <button type="button" className="adm-btn ghost" aria-label={`查看 ${row.model || "该模型"} 的生成记录详情`} onClick={() => setDetail(row)}>详情</button>,
    },
  ], [page]);

  const hasFilter = Boolean(keyword.trim() || mediaType || status !== "全部" || startDate || endDate);

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

        <div className="adm-page">
          <Panel
            className="user-history-panel"
            title="生成记录"
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
      </main>

      {detail ? <DetailDrawer key={detail.id} row={detail} onClose={() => setDetail(null)} /> : null}
    </div>
  );
}
