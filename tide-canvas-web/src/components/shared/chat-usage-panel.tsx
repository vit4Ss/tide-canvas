"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { Activity, ArrowDown, ArrowRight, ArrowUpRight, ChevronLeft, ChevronRight, CircleAlert, FileText, Info, KeyRound, RefreshCw, Search, SlidersHorizontal, X } from "lucide-react";
import { http } from "@/lib/http";
import { useAuth } from "@/hooks/use-auth";
import { useAuthStore } from "@/stores/use-auth-store";
import { usageDateParts, usageDateRange, usageStatuses, type ChatUsagePage, type UsageDatePreset } from "@/lib/chat-usage";
import { UsageOverview, UsageRows } from "./chat-usage-results";
import styles from "./chat-usage-panel.module.css";

const initialFilters = { model: "", status: "", protocol: "", stream: "", userId: "", startDate: "", endDate: "" };
const number = (value: number) => value.toLocaleString("zh-CN");
const periods: Array<[UsageDatePreset, string]> = [["all", "全部时间"], ["today", "今天"], ["7d", "近 7 天"], ["30d", "近 30 天"], ["custom", "自定义"]];

export default function ChatUsagePanel({ admin = false }: { admin?: boolean }) {
  const { user, initialized } = useAuth();
  if (!user) return <div className={styles.signedOut} role="status">
    <div className={styles.stateIcon}><KeyRound size={24} aria-hidden /></div>
    <h2>{initialized ? "你的用量，清楚可查" : "正在确认登录状态"}</h2>
    <p>{initialized ? "登录后查看每次 API 调用的 Token、费用与执行结果。" : "稍等片刻，正在准备你的用量记录。"}</p>
    {initialized && <Link className={styles.primary} href={`/login?redirect=${encodeURIComponent(admin ? "/admin/chat-usage" : "/api-usage")}`}>登录查看<ArrowRight size={15} aria-hidden /></Link>}
  </div>;
  return <UsageContent key={`${user.id}:${admin}`} accountId={user.id} admin={admin} />;
}

function UsageContent({ admin, accountId }: { admin: boolean; accountId: string }) {
  const [draft, setDraft] = useState(initialFilters);
  const [filters, setFilters] = useState(initialFilters);
  const [period, setPeriod] = useState<UsageDatePreset>("all");
  const [moreFilters, setMoreFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [result, setResult] = useState<{ key: string; url: string; data?: ChatUsagePage; error?: string; time?: string } | null>(null);
  const formId = useId();
  const recordsRef = useRef<HTMLDivElement>(null);
  const query = new URLSearchParams({ ...filters, pageNum: String(page), pageSize: "20", accountId });
  if (!admin) query.delete("userId");
  const requestURL = `${admin ? "/api/admin/chat-gateway-usage" : "/api/chat-gateway/usage"}?${query}`;
  const requestKey = `${accountId}:${revision}:${requestURL}`;
  const current = result?.key === requestKey ? result : null;
  // Keep the last successful page visible while a manual refresh is in flight.
  // A different filter still gets a clean loading state and cannot show stale rows.
  const sameQuery = result?.url === requestURL;
  const visible = current ?? (sameQuery ? result : null);
  const data = visible?.data;
  const fetching = !current;
  const loading = fetching && !data;

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const tokenAtStart = localStorage.getItem("access_token");
    let alive = true;
    const changed = (event: StorageEvent) => {
      if (event.key === "access_token" || event.key === null) {
        alive = false;
        controller.abort();
        setResult({ key: requestKey, url: requestURL, error: "登录状态已变化，请刷新后查看当前账号的记录" });
      }
    };
    window.addEventListener("storage", changed);
    void http.get<ChatUsagePage>(requestURL, undefined, { signal: controller.signal }).then(response => {
      if (!alive || useAuthStore.getState().user?.id !== accountId) return;
      if (tokenAtStart && !localStorage.getItem("access_token")) {
        setResult({ key: requestKey, url: requestURL, error: "登录已过期，请重新登录后查看" });
        return;
      }
      setResult(response.success && response.data
        ? { key: requestKey, url: requestURL, data: response.data, time: new Date().toISOString() }
        : { key: requestKey, url: requestURL, error: controller.signal.aborted ? "查询超时，请重试" : response.message || "调用记录读取失败" });
    }).catch(() => {
      if (alive) setResult({ key: requestKey, url: requestURL, error: "暂时无法读取调用记录，请重试" });
    }).finally(() => clearTimeout(timeout));
    return () => { alive = false; clearTimeout(timeout); controller.abort(); window.removeEventListener("storage", changed); };
  }, [accountId, requestURL, requestKey]);

  const apply = (next: typeof filters) => {
    setFilters(next);
    setPage(1);
    setExpanded(null);
    setRevision(n => n + 1);
  };
  const reset = () => { setDraft(initialFilters); setPeriod("all"); apply(initialFilters); };
  const choosePeriod = (next: UsageDatePreset) => {
    if (next === "custom") {
      setMoreFilters(true);
      requestAnimationFrame(() => document.getElementById(`${formId}-advanced`)?.querySelector<HTMLInputElement>('input[type="date"]')?.focus());
      return;
    }
    setPeriod(next);
    const dates = usageDateRange(next);
    setDraft(d => ({ ...d, ...dates }));
    apply({ ...filters, ...dates });
  };
  const chips = [
    filters.model && ["model", `模型：${filters.model}`],
    filters.status && ["status", usageStatuses[filters.status]?.label || filters.status],
    filters.protocol && ["protocol", filters.protocol === "chat" ? "Chat Completions" : "Responses"],
    filters.stream && ["stream", filters.stream === "true" ? "流式" : "非流式"],
    admin && filters.userId && ["userId", `用户：${filters.userId}`],
  ].filter(Boolean) as Array<[keyof typeof filters, string]>;
  const hasFilters = chips.length > 0 || !!filters.startDate || !!filters.endDate;
  const advancedCount = Number(!!filters.protocol) + Number(!!filters.stream) + Number(admin && !!filters.userId) + Number(!!filters.startDate || !!filters.endDate);
  const dateLabel = filters.startDate || filters.endDate ? `${filters.startDate || "最早"} — ${filters.endDate || "至今"}` : "全部时间";
  const dirty = (Object.keys(draft) as Array<keyof typeof draft>).some(key => draft[key] !== filters[key]);
  const goToRecords = () => {
    recordsRef.current?.scrollIntoView({ block: "start", behavior: "instant" });
    recordsRef.current?.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
  };

  return <section className={`${styles.panel} ${admin ? styles.admin : ""}`} aria-label="API 文本调用记录">
    <div className={styles.heading}>
      <div><div className={styles.eyebrow}><span className={styles.eyebrowMark} aria-hidden /><span>FLOWINGLIGHT / USAGE</span></div>
        <h1>{admin ? "API 调用记录" : "Token 用量"}<span className={styles.scope}>{admin ? "全部用户" : "我的 API"}</span></h1>
        <p>{admin ? "核对供应商调用、Token 消耗与实际积分。" : "查看你的 API 调用、Token 消耗与积分账单。"}</p>
      </div>
      <div className={styles.actions}>
        <Link className={styles.quietLink} href={admin ? "/admin/chat-providers" : "/api-docs#chat"}>{admin ? <SlidersHorizontal size={15} aria-hidden /> : <FileText size={15} aria-hidden />}{admin ? "供应商配置" : "接入文档"}</Link>
        {!admin && <Link className={styles.button} href="/account"><KeyRound size={14} aria-hidden />我的 API Key<ArrowUpRight size={14} aria-hidden /></Link>}
        <button type="button" className={styles.skipToRecords} onClick={goToRecords}>调用明细<ArrowDown size={14} aria-hidden /></button>
      </div>
    </div>
    <div className={styles.rangeBar}>
      <div className={styles.rangeButtons} role="group" aria-label="查询时间范围">{periods.map(([key, label]) => <button type="button" key={key} aria-pressed={period === key} onClick={() => choosePeriod(key)}>{label}</button>)}</div>
      <span className={styles.rangeNote}>{dateLabel}<span>UTC+8</span></span>
    </div>
    <UsageOverview data={data} loading={fetching} />
    <details className={styles.usageGuide}>
      <summary><Info size={14} aria-hidden />用量与费用如何计算<ChevronRight size={14} aria-hidden /></summary>
      <div><p><strong>统计范围</strong>概览汇总当前全部筛选结果，包含其他分页。这里只统计 API Key 对 AI 聊天供应商的调用。</p><p><strong>Token 用量</strong>输入包含缓存，输出包含推理，两者都是总量的一部分。未取得可靠用量时显示「—」。</p><p><strong>实际积分</strong>按每次调用时的单价结算，并扣除退款。预留额度、待结算和待核对费用不计入实扣积分。</p></div>
    </details>

    <div className={styles.records} ref={recordsRef} id={`${formId}-records`}>
      <div className={styles.recordsHeading}>
        <div><h2 tabIndex={-1}>调用明细</h2><span className={styles.recordCount} aria-label={data ? `${number(data.total)} 条记录` : loading ? "正在读取记录" : "记录暂不可用"}>{data ? number(data.total) : loading ? "…" : "—"}</span></div>
        <div className={styles.refreshGroup}><span className={fetching ? styles.updating : ""} role="status" aria-live="polite">{fetching ? "正在更新…" : current?.time ? `${usageDateParts(current.time).time} 更新` : ""}</span><button type="button" className={`${styles.iconButton} ${fetching ? styles.refreshing : ""}`} aria-label="刷新调用记录" aria-busy={fetching} title="刷新调用记录" disabled={fetching} onClick={() => setRevision(n => n + 1)}><RefreshCw size={15} aria-hidden /></button></div>
      </div>
      <form className={styles.filters} onInvalidCapture={event => {
        // Hidden advanced inputs must become visible before native validation
        // attempts to focus them (e.g. a reversed custom date range).
        if (!moreFilters && event.target instanceof HTMLInputElement) {
          const input = event.target;
          event.preventDefault();
          setMoreFilters(true);
          requestAnimationFrame(() => { input.focus(); input.reportValidity(); });
        }
      }} onSubmit={event => {
        event.preventDefault();
        if (draft.startDate !== filters.startDate || draft.endDate !== filters.endDate) setPeriod(draft.startDate || draft.endDate ? "custom" : "all");
        const normalized = { ...draft, model: draft.model.trim(), userId: draft.userId.trim() };
        setDraft(normalized);
        apply(normalized);
      }}>
        <div className={styles.filterMain}>
          <label className={styles.search}><Search size={16} aria-hidden /><span className={styles.srOnly}>搜索模型 ID</span><input maxLength={128} value={draft.model} onChange={e => setDraft({ ...draft, model: e.target.value })} placeholder="搜索模型 ID…" autoComplete="off" spellCheck={false} />{draft.model && <button type="button" aria-label="清空模型搜索" onClick={() => setDraft({ ...draft, model: "" })}><X size={14} aria-hidden /></button>}</label>
          <label className={styles.statusFilter}><span className={styles.srOnly}>调用状态</span><select value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value })}><option value="">全部状态</option>{Object.entries(usageStatuses).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select></label>
          <button type="button" className={`${styles.button} ${moreFilters ? styles.filterOpen : ""}`} aria-expanded={moreFilters} aria-controls={`${formId}-advanced`} onClick={() => setMoreFilters(v => !v)}><SlidersHorizontal size={15} aria-hidden />筛选{advancedCount > 0 && <span className={styles.filterCount}>{advancedCount}</span>}</button>
          <button type="submit" className={styles.primary}>{dirty ? "应用筛选" : "查询"}<ArrowRight size={14} aria-hidden /></button>
        </div>
        {dirty && <div className={styles.draftNotice} role="status"><span>筛选已修改，应用后更新结果</span><button type="button" onClick={() => setDraft(filters)}>撤销修改</button></div>}
        <div id={`${formId}-advanced`} className={styles.advanced} hidden={!moreFilters}>
          <label><span>调用接口</span><select value={draft.protocol} onChange={e => setDraft({ ...draft, protocol: e.target.value })}><option value="">全部接口</option><option value="chat">Chat Completions</option><option value="responses">Responses</option></select></label>
          <label><span>响应方式</span><select value={draft.stream} onChange={e => setDraft({ ...draft, stream: e.target.value })}><option value="">全部方式</option><option value="true">流式响应</option><option value="false">非流式响应</option></select></label>
          {admin && <label><span>用户 ID</span><input inputMode="numeric" pattern="[0-9]*" value={draft.userId} onChange={e => setDraft({ ...draft, userId: e.target.value })} placeholder="全部用户" /></label>}
          <label><span>开始日期 · 北京时间</span><input type="date" value={draft.startDate} max={draft.endDate || undefined} onChange={e => setDraft({ ...draft, startDate: e.target.value })} /></label>
          <label><span>结束日期</span><input type="date" min={draft.startDate || undefined} value={draft.endDate} onChange={e => setDraft({ ...draft, endDate: e.target.value })} /></label>
        </div>
        {hasFilters && <div className={styles.chips} aria-label="已应用的筛选">{chips.map(([key, label]) => <button type="button" key={key} onClick={() => { setDraft(d => ({ ...d, [key]: "" })); apply({ ...filters, [key]: "" }); }} aria-label={`移除${label}`} title={`移除${label}`}>{label}<X size={12} aria-hidden /></button>)}{(filters.startDate || filters.endDate) && <button type="button" aria-label="移除日期筛选" onClick={() => { setPeriod("all"); setDraft(d => ({ ...d, startDate: "", endDate: "" })); apply({ ...filters, startDate: "", endDate: "" }); }}>{dateLabel}<X size={12} aria-hidden /></button>}<button type="button" className={styles.clearFilters} onClick={reset}>清除筛选</button></div>}
      </form>

      {current?.error ? <div className={styles.empty} role="alert"><span className={styles.stateIcon}><CircleAlert size={24} aria-hidden /></span><h3>暂时无法读取用量</h3><p>{current.error}</p><button className={styles.button} type="button" onClick={() => setRevision(n => n + 1)}><RefreshCw size={14} aria-hidden />重新加载</button></div>
        : loading ? <div className={styles.skeletonList} role="status" aria-label="正在读取调用记录">{Array.from({ length: 5 }, (_, i) => <div className={styles.skeletonRow} key={i} aria-hidden><i /><i /><i /><i /></div>)}<span className={styles.srOnly}>正在读取调用记录</span></div>
          : !data?.records.length ? <div className={styles.empty}><span className={styles.stateIcon}><Activity size={26} aria-hidden /></span><h3>{hasFilters ? "没有符合条件的调用" : "第一笔调用，从这里开始"}</h3><p>{hasFilters ? "调整模型或时间范围，看看其他记录。" : "接入智能体或应用后，这里会显示你的 Token 用量与积分明细。"}</p>{hasFilters ? <button className={styles.button} type="button" onClick={reset}>清除筛选</button> : <Link className={styles.primary} href={admin ? "/admin/chat-providers" : "/api-docs#chat"}>{admin ? "配置供应商" : "查看接入方法"}<ArrowRight size={14} aria-hidden /></Link>}<small>仅记录此功能上线后受理的 AI 聊天供应商调用。</small></div>
            : <div className={styles.tableWrap}>
              <table className={styles.table}>
                <caption className={styles.srOnly}>API 调用明细，时间为北京时间，费用单位为积分</caption>
                <thead><tr><th scope="col">模型 / 接口</th>{admin && <th scope="col">用户 / 供应商</th>}<th scope="col" className={styles.numeric}>Token 用量</th><th scope="col" className={styles.numeric}>实扣积分</th><th scope="col" className={styles.numeric}>响应耗时</th><th scope="col" title="按调用时间倒序">调用时间 ↓</th><th scope="col">状态</th><th scope="col"><span className={styles.srOnly}>操作</span></th></tr></thead>
                {data.records.map(row => <UsageRows key={row.id} row={row} admin={admin} expanded={expanded === row.id} onToggle={() => setExpanded(expanded === row.id ? null : row.id)} />)}
              </table>
            </div>}
      <div className={styles.pager}>
        <span>{data?.total ? `第 ${number((page - 1) * 20 + 1)}–${number(Math.min(page * 20, data.total))} 条，共 ${number(data.total)} 条` : "每页 20 条"}</span>
        <nav aria-label="调用记录分页"><button type="button" className={styles.iconButton} aria-label="上一页" disabled={fetching || page <= 1} onClick={() => { setPage(n => n - 1); setExpanded(null); goToRecords(); }}><ChevronLeft size={16} aria-hidden /></button><span><b>{page}</b> / {Math.max(1, data?.pages ?? page)}</span><button type="button" className={styles.iconButton} aria-label="下一页" disabled={fetching || !data || page >= data.pages} onClick={() => { setPage(n => n + 1); setExpanded(null); goToRecords(); }}><ChevronRight size={16} aria-hidden /></button></nav>
      </div>
    </div>
    <div className={styles.notes}><p><span className={styles.noteDot} aria-hidden />只统计 AI 聊天供应商调用 · 重放请求不重复计次</p><Link href="/generation-history">查看生成与 Skill 记录<ArrowUpRight size={13} aria-hidden /></Link></div>
  </section>;
}
