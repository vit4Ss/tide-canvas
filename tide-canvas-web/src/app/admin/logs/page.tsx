"use client";

/* ============================================================================
   /admin/logs — 日志管理 (multi-tab).

   Wired to the real backend log surface:
     系统日志  GET /api/admin/logs          -> PageData<LogVO>          (model.SysLog)
     请求日志  GET /api/admin/logs/access   -> PageData<AccessLogVO>    (model.AccessLog)
     登录日志  GET /api/admin/logs/login    -> PageData<LoginLogVO>     (model.LoginLog)
     业务日志  GET /api/admin/logs/business -> PageData<BizLogVO>       (model.BizLog)
     模型日志  GET /api/admin/logs/model    -> PageData<ModelCallLogVO> (model.ModelCallLog)

   Each tab is a server-paged table with a keyword search, an optional filter-chip
   group (级别 / 结果 / 场景 — wired to the backend query), a derived summary KPI
   row, and a per-row 详情 drawer that shows EVERY field — including ones too wide
   for the table (UA / 查询串 / 端点 / 关联 / 备注) and the upstream request/response
   bodies pretty-printed with a 复制 button.
   ============================================================================ */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AdminTable,
  FilterChips,
  Panel,
  StatCardGrid,
  StatusPill,
  type Column,
  type StatusPillProps,
} from "@/components/admin";
import { adminLogsApi } from "@/lib/admin-logs-api";
import type {
  LogVO,
  LogQuery,
  AccessLogVO,
  LoginLogVO,
  BizLogVO,
  ModelCallLogVO,
} from "@/types/admin-logs";
import type { PageData, Result } from "@/types/api";
import { useAuthStore } from "@/stores/use-auth-store";

type PillTone = StatusPillProps["tone"];

const TABS = ["系统", "请求", "登录", "业务", "模型"] as const;
type Tab = (typeof TABS)[number];

/** HTTP status → pill tone (2xx green, 3xx blue, 4xx amber, 5xx/err red). */
function statusTone(status: number): PillTone {
  if (status >= 500 || status === 0) return "red";
  if (status >= 400) return "amber";
  if (status >= 300) return "blue";
  if (status >= 200) return "green";
  return "gray";
}

function okTone(success: number): PillTone {
  return success === 1 ? "green" : "red";
}

/** Shorten a long body for a table cell; full text shows in the 详情 drawer. */
function clip(s: string, n = 80): string {
  if (!s) return "—";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

/** Pretty-print a JSON string; leave non-JSON untouched. */
function pretty(s: string): string {
  if (!s) return "";
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

/* ── per-row detail drawer ───────────────────────────────────────────────── */

type DetailField =
  | { label: string; value: React.ReactNode }
  | { label: string; block: string; json?: boolean };

function isBlock(f: DetailField): f is { label: string; block: string; json?: boolean } {
  return "block" in f;
}

function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="adm-btn ghost"
      style={{ padding: "2px 9px", fontSize: 11 }}
      onClick={() => {
        try {
          void navigator.clipboard?.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        } catch {
          /* clipboard blocked */
        }
      }}
    >
      {done ? "已复制" : "复制"}
    </button>
  );
}

function LogDetailModal({
  title,
  fields,
  onClose,
}: {
  title: string;
  fields: DetailField[];
  onClose: () => void;
}) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShow(true));
    return () => cancelAnimationFrame(id);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const inline = fields.filter((f) => !isBlock(f));
  const blocks = fields.filter(isBlock);

  return (
    <div
      className={`adm-mask${show ? " show" : ""}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="adm-modal" role="dialog" aria-modal="true" style={{ maxWidth: 760 }}>
        <div className="adm-mhead">
          <div>
            <h2>{title}</h2>
            <div className="mh-sub">日志详情 · 只读</div>
          </div>
          <button type="button" className="x" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>
        <div className="adm-mbody">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "12px 20px",
            }}
          >
            {inline.map((f, i) =>
              !isBlock(f) ? (
                <div key={i} style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {f.label}
                  </span>
                  <span className="strong" style={{ wordBreak: "break-all" }}>
                    {f.value ?? "—"}
                  </span>
                </div>
              ) : null,
            )}
          </div>

          {blocks.map((f, i) =>
            isBlock(f) ? (
              <div key={i} style={{ marginTop: 16 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 6,
                  }}
                >
                  <span className="muted" style={{ fontSize: 12 }}>
                    {f.label}
                  </span>
                  {f.block ? <CopyBtn text={f.json ? pretty(f.block) : f.block} /> : null}
                </div>
                <pre
                  className="mono"
                  style={{
                    margin: 0,
                    maxHeight: 260,
                    overflow: "auto",
                    background: "rgba(127,127,127,.09)",
                    border: "1px solid rgba(127,127,127,.16)",
                    padding: 11,
                    borderRadius: 8,
                    fontSize: 12,
                    lineHeight: 1.5,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                  }}
                >
                  {f.block ? (f.json ? pretty(f.block) : f.block) : "—"}
                </pre>
              </div>
            ) : null,
          )}
        </div>
        <div className="adm-mfoot">
          <span className="foot-note">只读 · 按 Esc 关闭</span>
          <button type="button" className="adm-btn ghost" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── generic server-paged log table ──────────────────────────────────────── */

interface LogTableProps<T extends { id: string }> {
  load: (q: LogQuery) => Promise<Result<PageData<T>>>;
  columns: Column<T>[];
  searchPlaceholder: string;
  /** optional discrete filter chips → backend query patch */
  chips?: readonly string[];
  chipToQuery?: (chip: string) => Partial<LogQuery>;
  /** derived summary KPIs from the loaded rows */
  stats?: (rows: T[]) => { k: string; v: string }[];
  /** per-row detail fields → renders a 详情 column + drawer */
  detail?: (row: T) => { title: string; fields: DetailField[] };
}

function LogTable<T extends { id: string }>({
  load,
  columns,
  searchPlaceholder,
  chips,
  chipToQuery,
  stats,
  detail,
}: LogTableProps<T>) {
  const ensureSession = useAuthStore((s) => s.ensureSession);
  const [rows, setRows] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [chip, setChip] = useState<string>(chips?.[0] ?? "");
  const [detailRow, setDetailRow] = useState<T | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await ensureSession();
      const res = await load({
        pageNum: 1,
        pageSize: 100,
        keyword: query.trim() || undefined,
        ...(chipToQuery ? chipToQuery(chip) : {}),
      });
      if (res.success && res.data) {
        setRows(res.data.records);
        setTotal(res.data.total);
      } else {
        setError(res.message || "加载日志失败");
        setRows([]);
        setTotal(0);
      }
    } catch {
      setError("加载日志失败");
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [ensureSession, load, query, chip, chipToQuery]);

  useEffect(() => {
    run();
  }, [run]);

  // append a 详情 action column when a detail builder is supplied.
  const cols = useMemo<Column<T>[]>(() => {
    if (!detail) return columns;
    return [
      ...columns,
      {
        header: "",
        align: "right",
        cell: (r) => (
          <button
            type="button"
            className="adm-btn ghost"
            style={{ padding: "3px 11px", fontSize: 12 }}
            onClick={() => setDetailRow(r)}
          >
            详情
          </button>
        ),
      },
    ];
  }, [columns, detail]);

  const kpis = stats && rows.length > 0 ? stats(rows) : null;
  const active = detailRow && detail ? detail(detailRow) : null;

  return (
    <>
      {kpis ? <StatCardGrid items={kpis} /> : null}
      <Panel
        title="日志明细"
        sub={`共 ${total} 条${rows.length < total ? ` · 显示最新 ${rows.length}` : ""}`}
        tools={
          <>
            <div className="adm-search" style={{ margin: 0 }}>
              <span className="muted">⌕</span>
              <input
                placeholder={searchPlaceholder}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            {chips && chipToQuery ? (
              <FilterChips options={[...chips]} value={chip} onChange={setChip} />
            ) : null}
            <button type="button" className="adm-btn ghost" onClick={() => run()}>
              刷新
            </button>
          </>
        }
      >
        {loading ? (
          <div className="muted" style={{ padding: 32, textAlign: "center" }}>
            加载中…
          </div>
        ) : error ? (
          <div className="muted" style={{ padding: 32, textAlign: "center" }}>
            {error}
          </div>
        ) : rows.length === 0 ? (
          <div className="muted" style={{ padding: 32, textAlign: "center" }}>
            暂无日志记录
          </div>
        ) : (
          <AdminTable<T> rows={rows} rowKey={(r) => r.id} columns={cols} pageSize={20} total={total} />
        )}
      </Panel>

      {active ? (
        <LogDetailModal title={active.title} fields={active.fields} onClose={() => setDetailRow(null)} />
      ) : null}
    </>
  );
}

/* ── shared helpers ──────────────────────────────────────────────────────── */

const timeCol = <T extends { createTime: string }>(): Column<T> => ({
  header: "时间",
  className: "mono muted",
  cell: (r) => r.createTime || "—",
});

const pct = (num: number, den: number) => (den > 0 ? `${Math.round((num / den) * 100)}%` : "—");
const avg = (nums: number[]) =>
  nums.length ? `${Math.round(nums.reduce((a, b) => a + b, 0) / nums.length)}ms` : "—";
const userCell = (uid: string) => (uid === "0" ? "游客 / 系统" : uid);

/* ── tabs ────────────────────────────────────────────────────────────────── */

function SystemTab() {
  const columns: Column<LogVO>[] = useMemo(
    () => [
      timeCol<LogVO>(),
      { header: "级别", cell: (l) => <StatusPill tone={l.level === "ERROR" ? "red" : l.level === "WARN" ? "amber" : l.level === "SECURITY" ? "blue" : "gray"}>{l.level || "—"}</StatusPill> },
      { header: "模块", className: "mono", cell: (l) => l.module || "—" },
      { header: "信息", className: "strong", cell: (l) => clip(l.message, 60) },
      { header: "IP", className: "mono muted", cell: (l) => l.ip || "—" },
      { header: "操作人", cell: (l) => l.operator || "—" },
    ],
    [],
  );
  return (
    <LogTable<LogVO>
      load={adminLogsApi.list}
      columns={columns}
      searchPlaceholder="搜索信息 / 操作人"
      chips={["全部", "INFO", "WARN", "ERROR", "SECURITY"]}
      chipToQuery={(c) => (c === "全部" ? {} : { level: c })}
      stats={(rows) => [
        { k: "本批日志", v: String(rows.length) },
        { k: "错误", v: String(rows.filter((l) => l.level === "ERROR").length) },
        { k: "警告", v: String(rows.filter((l) => l.level === "WARN").length) },
        { k: "安全事件", v: String(rows.filter((l) => l.level === "SECURITY").length) },
      ]}
      detail={(l) => ({
        title: `系统日志 · ${l.module || "—"}`,
        fields: [
          { label: "时间", value: l.createTime || "—" },
          { label: "级别", value: l.level || "—" },
          { label: "模块", value: l.module || "—" },
          { label: "IP", value: l.ip || "—" },
          { label: "操作人", value: l.operator || "—" },
          { label: "日志 ID", value: l.id },
          { label: "信息", block: l.message },
        ],
      })}
    />
  );
}

function AccessTab() {
  const columns: Column<AccessLogVO>[] = useMemo(
    () => [
      timeCol<AccessLogVO>(),
      { header: "用户", className: "mono muted", cell: (l) => userCell(l.userId) },
      { header: "方法", className: "mono", cell: (l) => l.method },
      { header: "路径", className: "mono strong", cell: (l) => clip(l.path, 48) },
      { header: "状态", cell: (l) => <StatusPill tone={statusTone(l.status)}>{l.status}</StatusPill> },
      { header: "耗时", className: "mono muted", cell: (l) => `${l.latencyMs}ms` },
      { header: "IP", className: "mono muted", cell: (l) => l.ip || "—" },
    ],
    [],
  );
  return (
    <LogTable<AccessLogVO>
      load={adminLogsApi.access}
      columns={columns}
      searchPlaceholder="搜索路径 / IP"
      stats={(rows) => [
        { k: "本批请求", v: String(rows.length) },
        { k: "错误 (≥400)", v: String(rows.filter((l) => l.status >= 400).length) },
        { k: "平均耗时", v: avg(rows.map((l) => l.latencyMs)) },
        { k: "最慢", v: `${Math.max(0, ...rows.map((l) => l.latencyMs))}ms` },
      ]}
      detail={(l) => ({
        title: `请求日志 · ${l.method} ${l.path}`,
        fields: [
          { label: "时间", value: l.createTime || "—" },
          { label: "用户", value: userCell(l.userId) },
          { label: "方法", value: l.method },
          { label: "状态", value: l.status },
          { label: "耗时", value: `${l.latencyMs}ms` },
          { label: "IP", value: l.ip || "—" },
          { label: "请求 ID", value: l.requestId || "—" },
          { label: "路径", value: l.path },
          { label: "查询串", block: l.query || "" },
          { label: "User-Agent", block: l.userAgent || "" },
        ],
      })}
    />
  );
}

function LoginTab() {
  const columns: Column<LoginLogVO>[] = useMemo(
    () => [
      timeCol<LoginLogVO>(),
      { header: "账号", className: "strong", cell: (l) => l.account || "—" },
      { header: "动作", className: "mono", cell: (l) => l.action },
      { header: "渠道", className: "mono muted", cell: (l) => l.channel || "—" },
      { header: "结果", cell: (l) => <StatusPill tone={okTone(l.success)}>{l.success === 1 ? "成功" : "失败"}</StatusPill> },
      { header: "原因", className: "muted", cell: (l) => clip(l.failReason, 32) },
      { header: "IP", className: "mono muted", cell: (l) => l.ip || "—" },
    ],
    [],
  );
  return (
    <LogTable<LoginLogVO>
      load={adminLogsApi.login}
      columns={columns}
      searchPlaceholder="搜索账号 / IP"
      chips={["全部", "成功", "失败"]}
      chipToQuery={(c) => (c === "成功" ? { success: "1" } : c === "失败" ? { success: "0" } : {})}
      stats={(rows) => [
        { k: "本批事件", v: String(rows.length) },
        { k: "失败", v: String(rows.filter((l) => l.success === 0).length) },
        { k: "成功率", v: pct(rows.filter((l) => l.success === 1).length, rows.length) },
      ]}
      detail={(l) => ({
        title: `登录日志 · ${l.account || "—"}`,
        fields: [
          { label: "时间", value: l.createTime || "—" },
          { label: "账号", value: l.account || "—" },
          { label: "用户 ID", value: userCell(l.userId) },
          { label: "动作", value: l.action },
          { label: "渠道", value: l.channel || "—" },
          { label: "结果", value: l.success === 1 ? "成功" : "失败" },
          { label: "失败原因", value: l.failReason || "—" },
          { label: "IP", value: l.ip || "—" },
          { label: "User-Agent", block: l.userAgent || "" },
        ],
      })}
    />
  );
}

function BizTab() {
  const columns: Column<BizLogVO>[] = useMemo(
    () => [
      timeCol<BizLogVO>(),
      { header: "用户", className: "mono muted", cell: (l) => userCell(l.userId) },
      { header: "动作", className: "mono", cell: (l) => l.action },
      { header: "摘要", className: "strong", cell: (l) => clip(l.summary, 40) },
      { header: "金额", className: "mono", cell: (l) => (Number(l.amount) > 0 ? `¥${l.amount}` : "—") },
      { header: "积分", className: "mono", cell: (l) => (l.points ? (l.points > 0 ? `+${l.points}` : String(l.points)) : "—") },
      { header: "操作人", className: "mono muted", cell: (l) => (l.operatorId === "0" ? "系统" : l.operatorId) },
    ],
    [],
  );
  return (
    <LogTable<BizLogVO>
      load={adminLogsApi.business}
      columns={columns}
      searchPlaceholder="搜索摘要 / 备注"
      stats={(rows) => [
        { k: "本批事件", v: String(rows.length) },
        { k: "涉及金额", v: `¥${rows.reduce((a, l) => a + (Number(l.amount) || 0), 0).toFixed(2)}` },
        { k: "积分净变动", v: String(rows.reduce((a, l) => a + (l.points || 0), 0)) },
      ]}
      detail={(l) => ({
        title: `业务日志 · ${l.action}`,
        fields: [
          { label: "时间", value: l.createTime || "—" },
          { label: "用户", value: userCell(l.userId) },
          { label: "动作", value: l.action },
          { label: "摘要", value: l.summary || "—" },
          { label: "金额", value: Number(l.amount) > 0 ? `¥${l.amount}` : "—" },
          { label: "积分", value: l.points ? (l.points > 0 ? `+${l.points}` : String(l.points)) : "—" },
          { label: "关联", value: l.refType || l.refId ? `${l.refType || "—"} / ${l.refId || "—"}` : "—" },
          { label: "操作人", value: l.operatorId === "0" ? "系统" : l.operatorId },
          { label: "备注 / 详情", block: l.detail || "", json: true },
        ],
      })}
    />
  );
}

function ModelTab() {
  const columns: Column<ModelCallLogVO>[] = useMemo(
    () => [
      timeCol<ModelCallLogVO>(),
      { header: "用户", className: "mono muted", cell: (l) => userCell(l.userId) },
      { header: "场景", cell: (l) => <StatusPill tone="blue">{l.scene}</StatusPill> },
      { header: "模型", className: "mono strong", cell: (l) => l.model || "—" },
      { header: "结果", cell: (l) => <StatusPill tone={okTone(l.success)}>{l.success === 1 ? "成功" : "失败"}</StatusPill> },
      { header: "耗时", className: "mono muted", cell: (l) => `${l.durationMs}ms` },
      { header: "消耗", className: "mono", cell: (l) => (Number(l.cost) > 0 ? l.cost : "—") },
    ],
    [],
  );
  return (
    <LogTable<ModelCallLogVO>
      load={adminLogsApi.model}
      columns={columns}
      searchPlaceholder="搜索模型"
      chips={["全部", "chat", "optimize", "image", "video"]}
      chipToQuery={(c) => (c === "全部" ? {} : { scene: c })}
      stats={(rows) => [
        { k: "本批调用", v: String(rows.length) },
        { k: "成功率", v: pct(rows.filter((l) => l.success === 1).length, rows.length) },
        { k: "平均耗时", v: avg(rows.map((l) => l.durationMs)) },
        { k: "总消耗", v: rows.reduce((a, l) => a + (Number(l.cost) || 0), 0).toFixed(2) },
      ]}
      detail={(l) => ({
        title: `模型日志 · ${l.model || "—"}`,
        fields: [
          { label: "时间", value: l.createTime || "—" },
          { label: "用户", value: userCell(l.userId) },
          { label: "场景", value: l.scene },
          { label: "模型", value: l.model || "—" },
          { label: "结果", value: <StatusPill tone={okTone(l.success)}>{l.success === 1 ? "成功" : "失败"}</StatusPill> },
          { label: "HTTP 状态", value: l.httpStatus },
          { label: "耗时", value: `${l.durationMs}ms` },
          { label: "消耗", value: Number(l.cost) > 0 ? l.cost : "—" },
          { label: "上游任务 ID", value: l.upstreamTaskId || "—" },
          { label: "端点", value: l.endpoint || "—" },
          { label: "请求体", block: l.requestBody || "", json: true },
          ...(l.success === 1
            ? [{ label: "响应体", block: l.responseBody || "", json: true } as DetailField]
            : [{ label: "错误信息", block: l.errorMsg || "" } as DetailField]),
        ],
      })}
    />
  );
}

export default function AdminLogsPage() {
  const [tab, setTab] = useState<Tab>("系统");

  return (
    <>
      <div style={{ marginBottom: 16 }}>
        <FilterChips options={[...TABS]} value={tab} onChange={(v) => setTab(v as Tab)} />
      </div>
      {tab === "系统" ? <SystemTab /> : null}
      {tab === "请求" ? <AccessTab /> : null}
      {tab === "登录" ? <LoginTab /> : null}
      {tab === "业务" ? <BizTab /> : null}
      {tab === "模型" ? <ModelTab /> : null}
    </>
  );
}
