"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { http } from "@/lib/http";
import type { PageData } from "@/types/api";
import "./token-billing-panel.css";

interface Bill {
  id: string; userId: string; keyRevision: number; model: string; status: string;
  points: string; reservedPoints: string; inputTokens: number; outputTokens: number;
  cachedInputTokens: number; reasoningTokens: number; createTime: string; resolution?: string;
  pricing?: { inputPointsPerMillion: string; outputPointsPerMillion: string; cachedInputPointsPerMillion?: string };
}
const statuses: Record<string, string> = { pending: "生成中", success: "已结算", partial: "部分回复已结算", billing_pending: "待核对用量", released: "已释放预留", failed: "失败未扣费" };
const points = (value: string | number) => Number(value).toLocaleString("zh-CN", {maximumFractionDigits: 6});

export default function TokenBillingPanel({ admin = false }: { admin?: boolean }) {
  const [rows, setRows] = useState<Bill[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  // Admin-only: the backend filters by an exact user id, so this is applied on
  // submit rather than per keystroke.
  const [userId, setUserId] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Bill | null>(null);
  const [action, setAction] = useState("release");
  const [counts, setCounts] = useState({inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0});
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const endpoint = admin ? "/api/admin/lobehub-billing" : "/api/lobehub/billing";
  // A slow page/filter response must never overwrite a newer one: every load
  // claims a request id and only the current claim may touch the list.
  const requestRef = useRef(0);
  const load = useCallback(async () => {
    const requestID = ++requestRef.current;
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ pageNum: String(page), pageSize: "15", status });
      if (admin && userFilter) query.set("userId", userFilter);
      const response = await http.get<PageData<Bill>>(`${endpoint}?${query}`);
      if (requestID !== requestRef.current) return;
      if (!response.success || !response.data) {
        setError(response.message || "账单读取失败");
        return;
      }
      setRows(response.data.records);
      setTotal(response.data.total);
    } catch {
      if (requestID === requestRef.current) setError("账单读取失败，请稍后重试");
    } finally {
      if (requestID === requestRef.current) setLoading(false);
    }
  }, [admin, endpoint, page, status, userFilter]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => void load());
    return () => {
      cancelAnimationFrame(frame);
      requestRef.current += 1;
    };
  }, [load]);
  const resolve = async () => {
    if (!selected || saving || Array.from(reason.trim()).length < 4) return;
    setSaving(true); setError("");
    try {
      const response = await http.post(`${endpoint}/${selected.id}/resolve`, {action, ...counts, reason: reason.trim()});
      if (!response.success) { setError(response.message || "处理失败"); return; }
      setSelected(null); await load();
    } catch { setError("处理失败，请稍后重试"); }
    finally { setSaving(false); }
  };
  return <section className="token-billing-panel">
    <header><div><h2>Token 调用账单</h2><p>{admin ? "AI 聊天按每百万 Token 的输入、输出单价结算。上游未返回可信用量的调用保留预留额度，核对后再结算或释放。" : "按你 API Key 的实际 Token 用量结算，精确到 0.000001 积分。"}</p></div><button type="button" onClick={() => void load()} disabled={loading}>刷新</button></header>
    <div className="token-billing-filters"><label>账单状态 <select value={status} onChange={e => {setStatus(e.target.value);setPage(1);}}><option value="">全部</option>{Object.entries(statuses).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label>{admin && <form role="search" onSubmit={event => {event.preventDefault();const value = userId.trim();if (value && !/^\d+$/.test(value)) {setError("用户 ID 是纯数字（用户管理里可复制）");return;}setError("");setUserFilter(value);setPage(1);}}><label>用户 ID <input inputMode="numeric" value={userId} onChange={e => setUserId(e.target.value)} placeholder="全部用户" /></label><button type="submit" disabled={loading}>筛选</button></form>}<span>共 {total} 条</span></div>
    {error && <p role="alert" className="token-billing-error">{error}</p>}
    <div className="token-billing-table"><table><thead><tr><th>时间 / 模型</th>{admin && <th>用户</th>}<th>输入 / 输出 Token</th><th>积分</th><th>状态</th></tr></thead><tbody>
      {!rows.length && <tr><td colSpan={admin ? 5 : 4}>{loading ? "正在读取账单…" : "暂无 Token 调用记录"}</td></tr>}
      {rows.map(row => <tr key={row.id}><td><strong>{row.model}</strong><small>{new Date(row.createTime).toLocaleString("zh-CN")}</small><details><summary>计价与调用编号</summary><small>{row.id} · Key 版本 {row.keyRevision}</small><small>输入 {row.pricing?.inputPointsPerMillion ?? "—"} / 输出 {row.pricing?.outputPointsPerMillion ?? "—"} 积分 / 1M Token</small>{row.resolution && <small>核对依据：{row.resolution}</small>}</details></td>
        {admin && <td className="mono">{row.userId}</td>}
        <td>{row.status === "pending" ? "—" : `${row.inputTokens.toLocaleString()} / ${row.outputTokens.toLocaleString()}`}<small>缓存输入 {row.cachedInputTokens.toLocaleString()} · 推理输出 {row.reasoningTokens.toLocaleString()}</small></td>
        <td><strong>{row.status === "pending" || row.status === "billing_pending" ? "待结算" : points(row.points)}</strong>{(row.status === "pending" || row.status === "billing_pending") && <small>预留 {points(row.reservedPoints)} 积分</small>}</td>
        <td><span className={row.status === "billing_pending" ? "token-billing-warning" : ""}>{statuses[row.status] || row.status}</span>{admin && row.status === "billing_pending" && <button type="button" onClick={() => {setSelected(row);setReason("");setAction("release");setCounts({inputTokens:row.inputTokens,outputTokens:row.outputTokens,cachedInputTokens:row.cachedInputTokens,reasoningTokens:row.reasoningTokens});}}>核对处理</button>}</td></tr>)}
    </tbody></table></div>
    <footer><button type="button" disabled={loading || page <= 1} onClick={() => setPage(p => p - 1)}>上一页</button><span>第 {page} 页</span><button type="button" disabled={loading || page * 15 >= total} onClick={() => setPage(p => p + 1)}>下一页</button></footer>
    {selected && <form className="token-billing-resolve" onSubmit={event => {event.preventDefault();void resolve();}}><h3>核对账单 · {selected.model}</h3><label>处理方式 <select value={action} onChange={e => setAction(e.target.value)}><option value="release">释放预留，不收取费用</option><option value="settle">根据已核实的上游用量结算</option></select></label>
      {action === "settle" && <div className="token-billing-counts">{([{key:"inputTokens",label:"输入 Token"},{key:"outputTokens",label:"输出 Token"},{key:"cachedInputTokens",label:"缓存输入 Token"},{key:"reasoningTokens",label:"推理输出 Token"}] as const).map(item => <label key={item.key}>{item.label}<input type="number" min={0} step={1} required value={counts[item.key]} onChange={e => setCounts(p => ({...p,[item.key]:Number(e.target.value)}))} /></label>)}</div>}
      <label>处理依据<textarea required minLength={4} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} placeholder="填写上游日志依据或释放原因，不使用估算 Token" /></label><div><button type="submit" disabled={saving || Array.from(reason.trim()).length < 4}>{saving ? "处理中…" : "确认处理"}</button><button type="button" disabled={saving} onClick={() => setSelected(null)}>取消</button></div>
    </form>}
  </section>;
}
