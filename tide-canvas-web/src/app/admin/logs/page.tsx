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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, RefreshCw, Search } from "lucide-react";
import {
  AdminAlert,
  AdminEmptyState,
  AdminModal,
  AdminTable,
  FilterChips,
  FormCard,
  Panel,
  RowActions,
  StatusPill,
  type Column,
  type StatusPillProps,
  TableSkeleton,
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
const TAB_IDS: Record<Tab, string> = {
  系统: "system",
  请求: "access",
  登录: "login",
  业务: "business",
  模型: "model",
};

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

function LogDetailModal({
  title,
  fields,
  onClose,
}: {
  title: string;
  fields: DetailField[];
  onClose: () => void;
}) {
  const inline = fields.filter((f) => !isBlock(f));
  const blocks = fields.filter(isBlock);

  return (
    <AdminModal
      open
      size="xl"
      title={title}
      subtitle="日志详情 · 只读"
      footNote="只读记录，不会修改系统数据"
      cancelLabel="返回"
      saveLabel="完成"
      onClose={onClose}
      onSave={() => true}
    >
      {inline.length > 0 ? (
        <FormCard title="基本信息">
          <dl className="fgrid">
            {inline.map((f, i) =>
              !isBlock(f) ? (
                <div className="fld col2" key={`${f.label}-${i}`}>
                  <dt className="muted">{f.label}</dt>
                  <dd className="strong" style={{ margin: 0, wordBreak: "break-word" }}>
                    {f.value ?? "—"}
                  </dd>
                </div>
              ) : null,
            )}
          </dl>
        </FormCard>
      ) : null}

      {blocks.map((f, i) => (
        <FormCard title={f.label} key={`${f.label}-${i}`}>
          {f.block ? (
            <div className="adm-tools" style={{ marginBottom: 8 }}>
              <CopyBtn text={f.json ? pretty(f.block) : f.block} />
            </div>
          ) : null}
          <pre
            className="mono"
            style={{
              margin: 0,
              maxHeight: 320,
              overflow: "auto",
              background: "var(--panel)",
              border: "1px solid var(--border-weak)",
              padding: 12,
              borderRadius: "var(--r-sm)",
              fontSize: 12,
              lineHeight: 1.6,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {f.block ? (f.json ? pretty(f.block) : f.block) : "—"}
          </pre>
        </FormCard>
      ))}
    </AdminModal>
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

  // reqId 守卫:搜索/切筛选时并发请求,只有最新一次的响应生效(避免先发后到的旧结果覆盖)。
  const reqIdRef = useRef(0);
  const run = useCallback(async () => {
    const id = ++reqIdRef.current;
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
      if (id !== reqIdRef.current) return; // 过期响应丢弃
      if (res.success && res.data) {
        setRows(res.data.records);
        setTotal(res.data.total);
      } else {
        setError(res.message || "加载日志失败");
        setRows([]);
        setTotal(0);
      }
    } catch {
      if (id !== reqIdRef.current) return;
      setError("加载日志失败");
      setRows([]);
      setTotal(0);
    } finally {
      if (id === reqIdRef.current) setLoading(false);
    }
  }, [ensureSession, load, query, chip, chipToQuery]);

  // 防抖:搜索框每次按键都会改变 query→run,不防抖会逐字符发起 pageSize:100 查询。
  useEffect(() => {
    const t = setTimeout(() => void run(), 300);
    return () => clearTimeout(t);
  }, [run]);

  // append a 详情 action column when a detail builder is supplied.
  const cols = useMemo<Column<T>[]>(() => {
    if (!detail) return columns;
    return [
      ...columns,
      {
        header: "操作",
        align: "right",
        cell: (r) => (
          <RowActions actions={[{ label: "详情", onClick: () => setDetailRow(r) }]} />
        ),
      },
    ];
  }, [columns, detail]);

  const active = detailRow && detail ? detail(detailRow) : null;
  const summary =
    stats && rows.length > 0
      ? stats(rows)
          .map((s) => `${s.k} ${s.v}`)
          .join(" · ")
      : null;
  const hasActiveFilter = Boolean(query.trim()) || Boolean(chips && chip !== chips[0]);

  return (
    <>
      <Panel
        title="日志明细"
        sub={
          summary
            ? `共 ${total} 条 · ${summary}`
            : `共 ${total} 条${rows.length < total ? ` · 显示最新 ${rows.length}` : ""}`
        }
        tools={
          <>
            <div className="adm-search" role="search">
              <Search aria-hidden size={15} />
              <input
                aria-label="搜索日志"
                placeholder={searchPlaceholder}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            {chips && chipToQuery ? (
              <FilterChips
                label="日志结果筛选"
                options={[...chips]}
                value={chip}
                onChange={setChip}
              />
            ) : null}
            <button type="button" className="adm-btn ghost" onClick={() => run()}>
              <RefreshCw aria-hidden size={15} />
              刷新
            </button>
          </>
        }
      >
        {loading ? (
          <TableSkeleton />
        ) : error ? (
          <div style={{ padding: 16 }}>
            <AdminAlert
              tone="error"
              title="日志加载失败"
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
            title="没有找到日志记录"
            description={hasActiveFilter ? "尝试清除搜索或筛选条件。" : "当前日志分类暂时没有记录。"}
            action={hasActiveFilter ? (
              <button
                type="button"
                className="adm-btn ghost"
                onClick={() => {
                  setQuery("");
                  if (chips?.[0]) setChip(chips[0]);
                }}
              >
                清除筛选
              </button>
            ) : undefined}
          />
        ) : (
          <AdminTable<T>
            rows={rows}
            rowKey={(r) => r.id}
            columns={cols}
            pageSize={20}
            total={total}
            label="日志明细"
          />
        )}
      </Panel>

      {active ? (
        <LogDetailModal title={active.title} fields={active.fields} onClose={() => setDetailRow(null)} />
      ) : null}
    </>
  );
}

/* ── shared helpers ──────────────────────────────────────────────────────── */

/** ISO / RFC3339 → "YYYY-MM-DD HH:mm:ss" for scanability. */
function fmtLogTime(s: string): string {
  if (!s) return "—";
  const t = Date.parse(s);
  if (Number.isNaN(t)) return s.replace("T", " ").replace(/\+\d{2}:\d{2}$/, "").slice(0, 19);
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

const timeCol = <T extends { createTime: string }>(): Column<T> => ({
  header: "时间",
  className: "mono muted",
  cell: (r) => fmtLogTime(r.createTime),
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

  const selectTab = (next: Tab) => {
    setTab(next);
    requestAnimationFrame(() => document.getElementById(`log-tab-${TAB_IDS[next]}`)?.focus());
  };

  return (
    <div className="adm-page">
      <div className="adm-page-tabs">
        <div className="adm-segment" role="tablist" aria-label="日志分类">
          {TABS.map((item, index) => {
            const selected = item === tab;
            const id = TAB_IDS[item];
            return (
              <button
                key={item}
                type="button"
                id={`log-tab-${id}`}
                className={`adm-chip${selected ? " on" : ""}`}
                role="tab"
                aria-selected={selected}
                aria-controls={`log-panel-${id}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setTab(item)}
                onKeyDown={(event) => {
                  let nextIndex: number | null = null;
                  if (event.key === "ArrowRight") nextIndex = (index + 1) % TABS.length;
                  if (event.key === "ArrowLeft") nextIndex = (index - 1 + TABS.length) % TABS.length;
                  if (event.key === "Home") nextIndex = 0;
                  if (event.key === "End") nextIndex = TABS.length - 1;
                  if (nextIndex == null) return;
                  event.preventDefault();
                  selectTab(TABS[nextIndex]);
                }}
              >
                {item}
              </button>
            );
          })}
        </div>
      </div>
      <div
        role="tabpanel"
        id={`log-panel-${TAB_IDS[tab]}`}
        aria-labelledby={`log-tab-${TAB_IDS[tab]}`}
        tabIndex={0}
      >
        {tab === "系统" ? <SystemTab /> : null}
        {tab === "请求" ? <AccessTab /> : null}
        {tab === "登录" ? <LoginTab /> : null}
        {tab === "业务" ? <BizTab /> : null}
        {tab === "模型" ? <ModelTab /> : null}
      </div>
    </div>
  );
}
