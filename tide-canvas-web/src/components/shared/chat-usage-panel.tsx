"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Activity, ArrowDown, ArrowUp, ChevronDown, ChevronLeft, ChevronRight, Database, KeyRound, RefreshCw, Search } from "lucide-react";
import { http } from "@/lib/http";
import { useAuth } from "@/hooks/use-auth";
import { useAuthStore } from "@/stores/use-auth-store";
import { usageDuration, usagePoints, usageProtocol, usageStatuses, usageTime, type ChatUsagePage } from "@/lib/chat-usage";
import styles from "./chat-usage-panel.module.css";

const initialFilters = { model: "", status: "", protocol: "", stream: "", userId: "", startDate: "", endDate: "" };
const number = (value: number) => value.toLocaleString("zh-CN");

export default function ChatUsagePanel({ admin = false }: { admin?: boolean }) {
  const { user, initialized } = useAuth();
  if (!user) return <div className={styles.empty} role="status">{initialized ? <><KeyRound size={28} /><h2>登录后查看 API 调用记录</h2><Link href="/login?redirect=%2Fapi-usage">登录</Link></> : "正在确认登录状态…"}</div>;
  // Remount on identity changes: even already-rendered rows must disappear.
  return <UsageContent key={`${user.id}:${admin}`} accountId={user.id} admin={admin} />;
}

function UsageContent({ admin, accountId }: { admin: boolean; accountId: string }) {
  const [draft, setDraft] = useState(initialFilters);
  const [filters, setFilters] = useState(initialFilters);
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [result, setResult] = useState<{ key: string; data?: ChatUsagePage; error?: string } | null>(null);
  const query = new URLSearchParams({ ...filters, pageNum: String(page), pageSize: "20", accountId });
  if (!admin) {
    query.delete("userId");
  }
  const requestURL = `${admin ? "/api/admin/chat-gateway-usage" : "/api/chat-gateway/usage"}?${query}`;
  const requestKey = `${accountId}:${revision}:${requestURL}`;
  const current = result?.key === requestKey ? result : null;
  const data = current?.data;
  const loading = !current;
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const tokenAtStart = localStorage.getItem("access_token");
    let alive = true;
    const changed = (event: StorageEvent) => {
      if (event.key === "access_token" || event.key === null) {
        alive = false; controller.abort();
        setResult({ key: requestKey, error: "登录状态已变化，请刷新后查看当前账号的记录" });
      }
    };
    window.addEventListener("storage", changed);
    void http.get<ChatUsagePage>(requestURL, undefined, { signal: controller.signal }).then(response => {
      if (!alive || useAuthStore.getState().user?.id !== accountId) return;
      // A token refresh is allowed for the same account; logout is not.
      if (tokenAtStart && !localStorage.getItem("access_token")) return;
      setResult(response.success && response.data
        ? { key: requestKey, data: response.data }
        : { key: requestKey, error: controller.signal.aborted ? "查询超时，请重试" : response.message || "调用记录读取失败" });
    }).catch(() => {
      if (alive) setResult({ key: requestKey, error: "暂时无法读取调用记录，请重试" });
    }).finally(() => clearTimeout(timeout));
    return () => { alive = false; clearTimeout(timeout); controller.abort(); window.removeEventListener("storage", changed); };
  }, [accountId, requestURL, requestKey]);
  const stats = data?.summary;
  return <section className={styles.panel} aria-label="API 文本调用记录">
    <div className={styles.heading}>
      <div><span className={styles.eyebrow}><Activity size={14} /> API / TEXT USAGE</span><h1>API 调用记录</h1><p>查看{admin ? "全部用户" : "当前账号"}通过 API Key 使用 AI 聊天供应商的用量与积分。</p></div>
      <div className={styles.actions}><Link href={admin ? "/admin/chat-providers" : "/account"}>{admin ? "供应商配置" : "我的 API Key"}</Link><button type="button" disabled={loading} onClick={() => setRevision(n => n + 1)}><RefreshCw size={14} />刷新</button></div>
    </div>
    <div className={styles.metrics} aria-label="当前筛选合计">
      <div><span>调用次数</span><strong>{stats ? number(stats.calls) : "—"}<small>次</small></strong></div>
      <div><span>实扣积分 · 已减退款</span><strong className={styles.cost}>{stats ? Number(stats.points).toLocaleString("zh-CN", { maximumFractionDigits: 6 }) : "—"}</strong></div>
      <div><span>输入 / 输出 Token</span><strong>{stats ? number(stats.inputTokens) : "—"}<small>/ {stats ? number(stats.outputTokens) : "—"}</small></strong></div>
      <div><span>缓存命中 Token</span><strong>{stats ? number(stats.cachedInputTokens) : "—"}</strong></div>
    </div>
    <form className={styles.filters} onSubmit={event => { event.preventDefault(); setFilters({ ...draft, model: draft.model.trim(), userId: draft.userId.trim() }); setPage(1); setRevision(n => n + 1); setExpanded(null); }}>
      <label className={styles.modelFilter}><span>模型</span><div><Search size={14} /><input maxLength={128} value={draft.model} onChange={e => setDraft({ ...draft, model: e.target.value })} placeholder="搜索模型 ID" /></div></label>
      <label><span>状态</span><select value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value })}><option value="">全部状态</option>{Object.entries(usageStatuses).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select></label>
      <label><span>接口</span><select value={draft.protocol} onChange={e => setDraft({ ...draft, protocol: e.target.value })}><option value="">全部接口</option><option value="chat">Chat Completions</option><option value="responses">Responses</option></select></label>
      <label><span>响应</span><select value={draft.stream} onChange={e => setDraft({ ...draft, stream: e.target.value })}><option value="">全部方式</option><option value="true">流式</option><option value="false">非流式</option></select></label>
      {admin && <label><span>用户 ID</span><input inputMode="numeric" pattern="[0-9]*" value={draft.userId} onChange={e => setDraft({ ...draft, userId: e.target.value })} placeholder="全部用户" /></label>}
      <label><span>开始日期 · 北京时间</span><input type="date" value={draft.startDate} max={draft.endDate || undefined} onChange={e => setDraft({ ...draft, startDate: e.target.value })} /></label>
      <label><span>结束日期</span><input type="date" min={draft.startDate || undefined} value={draft.endDate} onChange={e => setDraft({ ...draft, endDate: e.target.value })} /></label>
      <button type="submit" className={styles.primary}>查询</button><button type="button" onClick={() => { setDraft(initialFilters); setFilters(initialFilters); setPage(1); setRevision(n => n + 1); }}>重置</button>
    </form>
    <div className={styles.tableCaption}><span>使用明细 <b>{data ? number(data.total) : "—"}</b></span><small>按次调用留档 · 缓存包含在输入中 · 费用单位为积分</small></div>
    {current?.error ? <div className={styles.empty} role="alert"><p>{current.error}</p><button type="button" onClick={() => setRevision(n => n + 1)}>重新加载</button></div> : <div className={styles.tableWrap} aria-busy={loading}>
      <table className={styles.table}><thead><tr><th>API Key / 模型</th>{admin && <th>用户 / IP</th>}<th>入站接口</th>{admin && <th>供应商</th>}<th>方式</th><th>Token 用量</th><th>积分</th><th>首字 / 总耗时</th><th>状态 / 时间</th><th><span className="sr-only">详情</span></th></tr></thead><tbody>
        {!data?.records.length && <tr><td colSpan={admin ? 10 : 8}><div className={styles.empty} role="status"><Database size={26} /><strong>{loading ? "正在读取调用记录…" : "暂无 API 文本调用"}</strong><span>仅展示启用此记录功能后受理的 AI 聊天供应商调用。</span></div></td></tr>}
        {data?.records.map(row => {
          const state = usageStatuses[row.status] || { label: row.status, tone: "muted" };
          return <UsageRows key={row.id} expanded={expanded === row.id} onToggle={() => setExpanded(expanded === row.id ? null : row.id)} row={row} state={state} admin={admin} />;
        })}
      </tbody></table>
    </div>}
    <div className={styles.pager}><span>{stats?.pending ? `${stats.pending} 笔待结算或核对 · ` : ""}同一请求重放不重复计次 · 仅统计已受理调用</span><div><button type="button" aria-label="上一页" disabled={loading || page <= 1} onClick={() => { setPage(n => n - 1); setExpanded(null); }}><ChevronLeft size={16} /></button><span>{page} / {Math.max(1, data?.pages ?? page)}</span><button type="button" aria-label="下一页" disabled={loading || !data || page >= data.pages} onClick={() => { setPage(n => n + 1); setExpanded(null); }}><ChevronRight size={16} /></button></div></div>
  </section>;
}

function UsageRows({ row, state, admin, expanded, onToggle }: { row: ChatUsagePage["records"][number]; state: { label: string; tone: string }; admin: boolean; expanded: boolean; onToggle: () => void }) {
  return <><tr>
    <td><small className={styles.key}><KeyRound size={11} />{row.keyHint || `默认 Key · v${row.keyRevision}`}</small><strong className={styles.model}>{row.modelName || row.model}</strong><small className={styles.mono}>{row.model}</small></td>
    {admin && <td><span className={styles.mono}>{row.userId}</span><small>{row.clientIP || "—"}</small></td>}
    <td><span className={styles.protocol}>{usageProtocol(row.requestPath)}</span><small className={styles.mono} title={row.requestPath}>{row.requestPath.replace("/api/integrations", "")}</small></td>
    {admin && <td>{row.providerName || "—"}{row.providerName && row.providerName !== row.billingProviderName && <small>备用渠道 · 按首选价格</small>}</td>}
    <td><span className={`${styles.badge} ${row.stream ? styles.active : styles.muted}`}>{row.stream ? "流式" : "非流式"}</span><small>Token 计费</small></td>
    <td><div className={styles.tokens}><span title="输入 Token（含缓存）"><ArrowDown size={12} />{row.usageKnown ? number(row.inputTokens) : "—"}</span><span title="输出 Token（含推理）"><ArrowUp size={12} />{row.usageKnown ? number(row.outputTokens) : "—"}</span></div><small className={styles.cache}><Database size={11} />缓存 {row.usageKnown ? number(row.cachedInputTokens) : "—"}</small></td>
    <td><strong className={styles.cost}>{usagePoints(row)}</strong>{["pending", "billing_pending"].includes(row.status) ? <small>预留 {row.reservedPoints}</small> : Number(row.refundedPoints ?? "0") > 0 ? <small>原扣 {row.points} · 已退 {row.refundedPoints}</small> : <small>已结算</small>}{row.priceMultiplier && row.priceMultiplier !== "1" && <small>价格倍率 ×{row.priceMultiplier}</small>}</td>
    <td className={styles.mono}>{usageDuration(row.firstTokenMs)}<small>{usageDuration(row.durationMs)}</small></td>
    <td><span className={`${styles.badge} ${styles[state.tone]}`}>{state.label}</span><small className={styles.timestamp}>{usageTime(row.createTime)}</small></td>
    <td><button type="button" className={styles.expand} aria-label={`查看 ${row.model} 调用详情`} aria-expanded={expanded} onClick={onToggle}><ChevronDown size={15} style={{ transform: expanded ? "rotate(180deg)" : undefined }} /></button></td>
  </tr>{expanded && <tr className={styles.detail}><td colSpan={admin ? 10 : 8}><dl><dt>调用编号</dt><dd>{row.id}</dd><dt>Key 版本</dt><dd>{row.keyRevision}</dd><dt>推理 Token</dt><dd>{row.usageKnown ? number(row.reasoningTokens) : "未返回可靠用量"}</dd><dt>错误标识</dt><dd>{row.errorCode || "无"}</dd><dt>输入 / 输出单价</dt><dd>{row.pricing ? `${row.pricing.inputPointsPerMillion} / ${row.pricing.outputPointsPerMillion} 积分 / 1M` : "—"}</dd><dt>缓存输入单价</dt><dd>{row.pricing ? `${row.pricing.cachedInputPointsPerMillion ?? row.pricing.inputPointsPerMillion} 积分 / 1M` : "—"}</dd>{admin && <><dt>计价供应商</dt><dd>{row.billingProviderName || "—"}</dd><dt>实际接入地址 ID</dt><dd>{row.endpointId === "0" ? "—" : row.endpointId || "—"}</dd><dt>上游 HTTP</dt><dd>{row.upstreamStatus || "未收到响应"}</dd></>}</dl><p>以上单价为调用时已应用倍率的价格。缓存包含在输入中，推理包含在输出中，不重复计费。首字和总耗时测量上游处理过程，未采集的值显示为空。</p></td></tr>}</>;
}
