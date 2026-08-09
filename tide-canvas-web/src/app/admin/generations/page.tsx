"use client";

/* ============================================================================
   /admin/generations — 生成记录。

   每一次模型调用的审计视图(数据源 = model_call_log,与日志管理的模型日志
   同表,覆盖 chat/assistant/optimize/image/video/audio 全场景):

     列表:类型 / 用户 / 模型 / Prompt 摘要 / 状态 / 平台积分 / 耗时 / 时间,
     支持 Prompt 关键词、类型、状态、日期范围筛选,服务端分页。

     详情(右侧抽屉):生成结果(视频/图片/音频预览或文本回复)→ 生成参数网格
     → 输入素材(参考图缩略图 + chat 附件)→ 完整 Prompt → 技术信息 →
     原始请求/响应报文(可折叠、可复制)。
   ============================================================================ */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Copy,
  FileText,
  Music,
  RefreshCw,
  Search,
  Video,
} from "lucide-react";
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
import { adminGenerationsApi } from "@/lib/admin-generations-api";
import type {
  GenAsset,
  GenerationDetailVO,
  GenerationRowVO,
} from "@/types/admin-generations";
import { useAuthStore } from "@/stores/use-auth-store";
import { UserRole } from "@/types/user";

type PillTone = StatusPillProps["tone"];

/* ── 场景词汇 ────────────────────────────────────────────────────────── */

const SCENE_LABEL: Record<string, string> = {
  image: "图片",
  video: "视频",
  audio: "音频",
  chat: "对话",
  assistant: "画布助手",
  optimize: "提示词优化",
  compact: "对话压缩",
  "blog-polish": "博客润色",
  skill: "技能",
};

function sceneLabel(scene: string): string {
  return SCENE_LABEL[scene] ?? scene ?? "—";
}

function sceneTone(scene: string): PillTone {
  switch (scene) {
    case "video":
      return "green";
    case "image":
      return "blue";
    case "audio":
      return "amber";
    default:
      return "gray";
  }
}

const SCENE_OPTIONS = ["全部", "图片", "视频", "音频", "对话", "画布助手", "提示词优化"] as const;
const SCENE_TO_KEY: Record<string, string | undefined> = {
  全部: undefined,
  图片: "image",
  视频: "video",
  音频: "audio",
  对话: "chat",
  画布助手: "assistant",
  提示词优化: "optimize",
};

const STATUS_OPTIONS = ["全部", "成功", "失败"] as const;

/* ── 小工具 ──────────────────────────────────────────────────────────── */

/** 耗时:模型调用是秒~分钟级(与日志页同口径)。 */
function dur(ms: number): string {
  if (!ms || ms <= 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}秒`;
  const t = Math.round(ms / 1000);
  return `${Math.floor(t / 60)}分${t % 60}秒`;
}

function fmtTime(s: string): string {
  if (!s) return "—";
  const t = Date.parse(s);
  if (Number.isNaN(t)) return s;
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function Trunc({ text }: { text: string }) {
  if (!text) return <>—</>;
  return (
    <span className="truncate" title={text}>
      {text}
    </span>
  );
}

function pretty(s: string): string {
  if (!s) return "";
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

function displayModelName(row: Pick<GenerationRowVO, "modelName" | "model">): string {
  return row.modelName || row.model || "—";
}

function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  return (
    <button
      type="button"
      className="adm-chip"
      style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
      aria-live="polite"
      onClick={() => {
        try {
          void navigator.clipboard?.writeText(text);
          setDone(true);
          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => setDone(false), 1200);
        } catch {
          /* clipboard blocked */
        }
      }}
    >
      {done ? <Check aria-hidden size={13} /> : <Copy aria-hidden size={13} />}
      {done ? "已复制" : "复制"}
    </button>
  );
}

/* ── 详情抽屉 ────────────────────────────────────────────────────────── */

function SecTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="genr-sec-t">{children}</h3>;
}

/** 生成结果:按 kind 渲染媒体预览;文本场景显示回复;空结果显示占位。 */
function ResultBlock({ d }: { d: GenerationDetailVO }) {
  const results = d.results ?? [];
  if (results.length > 0) {
    return (
      <div className="genr-media" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {results.map((r, i) => {
          const key = r.url ?? String(i);
          const caption = r.name ? (
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{r.name}</div>
          ) : null;
          if (r.kind === "video") {
            return (
              <div key={key}>
                <video controls preload="metadata" src={r.url} />
                {caption}
              </div>
            );
          }
          if (r.kind === "audio") {
            return (
              <div key={key}>
                <audio controls preload="metadata" src={r.url} />
                {caption}
              </div>
            );
          }
          return (
            <a key={key} href={r.url} target="_blank" rel="noreferrer">
              <img src={r.url} alt={r.name ?? `生成结果 ${i + 1}`} loading="lazy" />
            </a>
          );
        })}
      </div>
    );
  }
  if (d.reply) {
    return <pre className="genr-reply">{d.reply}</pre>;
  }
  return (
    <div className="genr-media-empty">
      {d.success === 1
        ? "无在线结果(异步任务未回传或链接已过期)"
        : d.errorMsg || "调用失败,无生成结果"}
    </div>
  );
}

function AssetIcon({ kind }: { kind: string }) {
  if (kind === "video") return <Video aria-hidden size={14} />;
  if (kind === "audio") return <Music aria-hidden size={14} />;
  return <FileText aria-hidden size={14} />;
}

/** 输入素材:图片给缩略图(点击看原图),文档/音视频给文件名 chip。 */
function InputsBlock({ inputs }: { inputs: GenAsset[] }) {
  if (inputs.length === 0) {
    return <div className="genr-media-empty">无输入素材</div>;
  }
  return (
    <div className="genr-assets">
      {inputs.map((a, i) => {
        const key = a.url ?? `${a.name}-${i}`;
        if (a.kind === "image" && a.url) {
          return (
            <a key={key} href={a.url} target="_blank" rel="noreferrer" title={a.name || a.url}>
              <img className="thumb" src={a.url} alt={a.name ?? `输入素材 ${i + 1}`} loading="lazy" />
            </a>
          );
        }
        return (
          <span key={key} className="genr-file" title={a.name || a.url}>
            <AssetIcon kind={a.kind} />
            <span>{a.name || a.url || "附件"}</span>
          </span>
        );
      })}
    </div>
  );
}

function TechRow({ k, mono, children }: { k: string; mono?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <dt>{k}</dt>
      <dd className={mono ? "mono" : undefined}>{children ?? "—"}</dd>
    </div>
  );
}

function GenerationDetailDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const ensureSession = useAuthStore((s) => s.ensureSession);
  const canViewRawBodies = useAuthStore((s) => s.user?.role === UserRole.ADMIN);
  const [d, setD] = useState<GenerationDetailVO | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        await ensureSession();
        const res = await adminGenerationsApi.detail(id);
        if (!alive) return;
        if (res.success && res.data) setD(res.data);
        else setError(res.message || "加载详情失败");
      } catch {
        if (alive) setError("加载详情失败");
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, ensureSession]);

  return (
    <AdminDrawer
      open
      title="生成记录详情"
      extra={d ? <StatusPill tone={d.success === 1 ? "green" : "red"}>{d.success === 1 ? "成功" : "失败"}</StatusPill> : undefined}
      onClose={onClose}
    >
      {error ? (
        <AdminAlert tone="error" title="详情加载失败">{error}</AdminAlert>
      ) : !d ? (
        <div aria-busy="true">
          <span className="sr-only" role="status">正在加载详情</span>
          <div className="skel" style={{ height: 14, width: "38%", borderRadius: 4 }} />
          <div className="skel" style={{ height: 200, borderRadius: 8, marginTop: 16 }} />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 16 }}>
            {[0, 1, 2].map((i) => (
              <div className="skel" key={i} style={{ height: 52, borderRadius: 8 }} />
            ))}
          </div>
          <div className="skel" style={{ height: 14, width: "24%", borderRadius: 4, marginTop: 16 }} />
          <div className="skel" style={{ height: 88, borderRadius: 8, marginTop: 10 }} />
        </div>
      ) : (
        <>
          {/* 头部摘要:场景 pill + 模型 + 时间·用户 */}
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <StatusPill tone={sceneTone(d.scene)}>{sceneLabel(d.scene)}</StatusPill>
              <span className="strong" style={{ fontSize: 15, wordBreak: "break-all" }}>
                {displayModelName(d)}
              </span>
            </div>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
              {fmtTime(d.createTime)} · {d.username || d.userId || "—"}
            </div>
          </div>

          <section>
            <SecTitle>生成结果</SecTitle>
            <ResultBlock d={d} />
          </section>

          <section>
            <SecTitle>生成参数</SecTitle>
            <div className="genr-grid">
              {(d.params ?? []).map((p) => (
                <div className="genr-cell" key={p.key}>
                  <div className="k">{p.key}</div>
                  <div className="v">
                    {p.key.trim().toLowerCase() === "model" ? displayModelName(d) : p.value}
                  </div>
                </div>
              ))}
              <div className="genr-cell">
                <div className="k">平台积分消耗</div>
                <div className="v">
                  {d.pointCost != null
                    ? d.success === 1
                      ? d.pointCost
                      : `${d.pointCost}（已退款）`
                    : "—"}
                </div>
              </div>
              <div className="genr-cell">
                <div className="k">耗时</div>
                <div className="v">{dur(d.durationMs)}</div>
              </div>
            </div>
          </section>

          <section>
            <SecTitle>输入素材{d.inputs?.length ? ` ${d.inputs.length} 个` : ""}</SecTitle>
            <InputsBlock inputs={d.inputs ?? []} />
          </section>

          <section>
            <SecTitle>Prompt</SecTitle>
            {d.prompt ? (
              <pre className="genr-prompt">{d.prompt}</pre>
            ) : (
              <div className="genr-media-empty">无 Prompt(或未解析出,见原始请求报文)</div>
            )}
          </section>

          <section>
            <SecTitle>技术信息</SecTitle>
            <dl className="genr-tech">
              <TechRow k="ID" mono>{d.id}</TechRow>
              <TechRow k="任务 ID" mono>
                {d.upstreamTaskId ? (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    {d.upstreamTaskId}
                    <CopyBtn text={d.upstreamTaskId} />
                  </span>
                ) : "—"}
              </TechRow>
              <TechRow k="类型">{sceneLabel(d.scene)}</TechRow>
              <TechRow k="用户">{d.username || d.userId || "—"}</TechRow>
              <TechRow k="HTTP 状态">{d.httpStatus || "—"}</TechRow>
              <TechRow k="端点" mono>{d.endpoint || "—"}</TechRow>
              <TechRow k="开始时间">{fmtTime(d.startTime)}</TechRow>
              <TechRow k="创建时间">{fmtTime(d.createTime)}</TechRow>
              {d.success !== 1 && d.errorMsg ? <TechRow k="错误信息">{d.errorMsg}</TechRow> : null}
            </dl>
          </section>

          {canViewRawBodies &&
          (d.requestBody !== undefined || d.responseBody !== undefined) ? (
            <section>
              <SecTitle>原始报文</SecTitle>
              <details>
                <summary className="muted" style={{ cursor: "pointer", fontSize: 12.5 }}>请求体</summary>
                <div className="adm-tools" style={{ margin: "8px 0" }}>
                  <CopyBtn text={pretty(d.requestBody ?? "")} />
                </div>
                <pre className="genr-prompt mono" style={{ fontSize: 12 }}>{pretty(d.requestBody ?? "") || "—"}</pre>
              </details>
              <details style={{ marginTop: 12 }}>
                <summary className="muted" style={{ cursor: "pointer", fontSize: 12.5 }}>响应体</summary>
                <div className="adm-tools" style={{ margin: "8px 0" }}>
                  <CopyBtn text={pretty(d.responseBody ?? "")} />
                </div>
                <pre className="genr-prompt mono" style={{ fontSize: 12 }}>{pretty(d.responseBody ?? "") || "—"}</pre>
              </details>
            </section>
          ) : null}
        </>
      )}
    </AdminDrawer>
  );
}

/* ── 页面 ────────────────────────────────────────────────────────────── */

export default function AdminGenerationsPage() {
  const ensureSession = useAuthStore((s) => s.ensureSession);
  const [rows, setRows] = useState<GenerationRowVO[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState("");
  const [sceneOpt, setSceneOpt] = useState<string>(SCENE_OPTIONS[0]);
  const [statusOpt, setStatusOpt] = useState<string>(STATUS_OPTIONS[0]);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState<string | null>(null);

  const PAGE_SIZE = 20;
  const reqIdRef = useRef(0);
  const run = useCallback(async () => {
    const id = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    try {
      await ensureSession();
      const res = await adminGenerationsApi.list({
        pageNum: page,
        pageSize: PAGE_SIZE,
        keyword: keyword.trim() || undefined,
        scene: SCENE_TO_KEY[sceneOpt],
        success: statusOpt === "成功" ? "1" : statusOpt === "失败" ? "0" : undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      });
      if (id !== reqIdRef.current) return;
      if (res.success && res.data) {
        setRows(res.data.records);
        setTotal(res.data.total);
      } else {
        setError(res.message || "加载生成记录失败");
        setRows([]);
        setTotal(0);
      }
    } catch {
      if (id !== reqIdRef.current) return;
      setError("加载生成记录失败");
      setRows([]);
      setTotal(0);
    } finally {
      if (id === reqIdRef.current) setLoading(false);
    }
  }, [ensureSession, page, keyword, sceneOpt, statusOpt, startDate, endDate]);

  // 筛选/搜索/翻页变化后重新加载;关键词等文本输入走 300ms 防抖。
  useEffect(() => {
    const t = setTimeout(() => void run(), 300);
    return () => clearTimeout(t);
  }, [run]);

  // 筛选条件变化时回到第 1 页(在事件回调里一并设置,不进 effect)。
  const applyFilter = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setPage(1);
  };

  const columns: Column<GenerationRowVO>[] = useMemo(
    () => [
      {
        header: "#",
        width: 48,
        className: "mono muted",
        cell: (_r, i) => (page - 1) * PAGE_SIZE + i + 1,
      },
      {
        header: "类型",
        width: 92,
        cell: (r) => <StatusPill tone={sceneTone(r.scene)}>{sceneLabel(r.scene)}</StatusPill>,
      },
      {
        header: "用户",
        width: 110,
        className: "muted",
        cell: (r) => <Trunc text={r.userId === "0" ? "系统" : r.username || r.userId} />,
      },
      {
        header: "模型",
        /* 固定 200：模型名最长 ~160px("Nano Banana 2 (4K)")，不设宽时 fixed 布局
           把剩余空间均分给模型/Prompt 两列，模型列留下一大块空白死区 */
        width: 200,
        className: "strong",
        cell: (r) => <Trunc text={displayModelName(r)} />,
      },
      {
        header: "Prompt",
        className: "muted",
        cell: (r) => <Trunc text={r.prompt} />,
      },
      {
        header: "状态",
        width: 76,
        cell: (r) => (
          <StatusPill tone={r.success === 1 ? "green" : "red"}>{r.success === 1 ? "成功" : "失败"}</StatusPill>
        ),
      },
      {
        header: "平台积分",
        width: 84,
        align: "right",
        className: "mono",
        // 失败/取消的任务积分全额退款(服务端 refund 口径),净消耗为 0,显示「—」
        cell: (r) => (r.pointCost != null && r.success === 1 ? r.pointCost : "—"),
      },
      {
        header: "耗时",
        width: 88,
        align: "right",
        className: "mono muted",
        cell: (r) => dur(r.durationMs),
      },
      {
        header: "创建时间",
        /* 190 = 19 字符等宽时间串(≈143px) + 两侧 18px 内边距,再窄会折行(与日志页同) */
        width: 190,
        className: "mono muted",
        cell: (r) => fmtTime(r.createTime),
      },
      {
        header: "操作",
        /* 88 = 详情按钮实测 75px + 余量;72 会让按钮探出表格右缘 3px(fixed 布局
           单元格 overflow:visible,按钮直接画出面板边框外) */
        width: 88,
        align: "right",
        cell: (r) => (
          <button type="button" className="adm-btn ghost" onClick={() => setDetailId(r.id)}>
            详情
          </button>
        ),
      },
    ],
    [page],
  );

  const hasFilter =
    Boolean(keyword.trim()) ||
    sceneOpt !== SCENE_OPTIONS[0] ||
    statusOpt !== STATUS_OPTIONS[0] ||
    Boolean(startDate) ||
    Boolean(endDate);

  return (
    <div className="adm-page">
      <Panel
        title="生成记录"
        sub={loading && !rows.length ? "正在加载记录…" : `共 ${total.toLocaleString()} 条记录`}
        tools={
          <>
            <div className="adm-search" role="search">
              <Search aria-hidden size={15} />
              <input
                aria-label="搜索 Prompt 关键词"
                placeholder="搜索 Prompt / 模型关键词"
                value={keyword}
                onChange={(e) => applyFilter(setKeyword)(e.target.value)}
              />
            </div>
            <button type="button" className="adm-btn ghost" onClick={() => run()}>
              <RefreshCw aria-hidden size={15} />
              刷新
            </button>
          </>
        }
      >
        {/* 筛选行：与表格左缘对齐（adm-filter-row 惯例，同用户管理页），
            避免全部挤进头部工具栏导致窄视口换行掉行 */}
        <div className="adm-filter-row">
          <select
            className="genr-select"
            aria-label="类型筛选"
            value={sceneOpt}
            onChange={(e) => applyFilter(setSceneOpt)(e.target.value)}
          >
            {SCENE_OPTIONS.map((o) => (
              <option key={o} value={o}>{o === "全部" ? "类型：全部" : o}</option>
            ))}
          </select>
          <select
            className="genr-select"
            aria-label="状态筛选"
            value={statusOpt}
            onChange={(e) => applyFilter(setStatusOpt)(e.target.value)}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o} value={o}>{o === "全部" ? "状态：全部" : o}</option>
            ))}
          </select>
          <input
            type="date"
            className="genr-date"
            aria-label="开始日期"
            value={startDate}
            onChange={(e) => applyFilter(setStartDate)(e.target.value)}
          />
          <span className="muted" style={{ fontSize: 12 }}>至</span>
          <input
            type="date"
            className="genr-date"
            aria-label="结束日期"
            value={endDate}
            onChange={(e) => applyFilter(setEndDate)(e.target.value)}
          />
        </div>
        {loading ? (
          <TableSkeleton />
        ) : error ? (
          <div style={{ padding: 16 }}>
            <AdminAlert
              tone="error"
              title="生成记录加载失败"
              action={
                <button type="button" className="adm-btn ghost" onClick={() => run()}>
                  <RefreshCw aria-hidden size={15} />
                  重新加载
                </button>
              }
            >
              {error}
            </AdminAlert>
          </div>
        ) : rows.length === 0 ? (
          <AdminEmptyState
            title="没有找到生成记录"
            description={hasFilter ? "尝试清除搜索或筛选条件。" : "暂时还没有模型调用记录。"}
            action={
              hasFilter ? (
                <button
                  type="button"
                  className="adm-btn ghost"
                  onClick={() => {
                    setKeyword("");
                    setSceneOpt(SCENE_OPTIONS[0]);
                    setStatusOpt(STATUS_OPTIONS[0]);
                    setStartDate("");
                    setEndDate("");
                    setPage(1);
                  }}
                >
                  清除筛选
                </button>
              ) : undefined
            }
          />
        ) : (
          <AdminTable<GenerationRowVO>
            rows={rows}
            rowKey={(r) => r.id}
            columns={columns}
            label="生成记录"
            server={{ page, pageSize: PAGE_SIZE, total, onPage: setPage }}
          />
        )}
      </Panel>

      {detailId ? (
        // key 强制按记录重挂载:切到另一条记录时旧详情不残留,也避免在
        // effect 里同步 setState 重置(react-hooks/set-state-in-effect)。
        <GenerationDetailDrawer key={detailId} id={detailId} onClose={() => setDetailId(null)} />
      ) : null}
    </div>
  );
}
