"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BellRing, Check, ChevronRight, Plus, RefreshCw, Search, Send, Trash2 } from "lucide-react";
import {
  AdminAlert, AdminDrawer, AdminEmptyState, AdminModal, AdminTable, Field, FormCard, FormGrid,
  Panel, RowActions, StatusPill, SwitchToggle, TableSkeleton,
} from "@/components/admin";
import { confirmDialog } from "@/components/shared/confirm";
import { toast } from "@/components/shared/toast";
import { adminAlertApi } from "@/lib/admin-alert-api";
import { useAuthStore } from "@/stores/use-auth-store";
import type { AlertChannel, AlertChannelInput, AlertDelivery, AlertEvent, AlertRule, AlertRuleInput, AlertSeverity } from "@/types/admin-alerts";
import "./alerts.css";

type Tab = "channels" | "rules" | "events";
const severities: Array<{ value: AlertSeverity; label: string }> = [
  { value: "info", label: "提示" }, { value: "warning", label: "警告" },
  { value: "error", label: "错误" }, { value: "critical", label: "严重" },
];
const channelNames = { feishu: "飞书", dingtalk: "钉钉", telegram: "Telegram" } as const;

const blankChannel = (): AlertChannelInput => ({ name: "", type: "feishu", enabled: true, minSeverity: "warning", config: {} });
const blankRule = (): AlertRuleInput => ({ name: "", enabled: true, eventPatterns: ["ai.*"], minSeverity: "warning", channelIds: [], cooldownSeconds: 300, aggregateSeconds: 0, sendRecovery: true });
const fmtTime = (value: string) => value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "—";
const severityLabel = (value: string) => severities.find((item) => item.value === value)?.label ?? value;
const severityTone = (value: string): "gray" | "amber" | "red" | "blue" => value === "critical" || value === "error" ? "red" : value === "warning" ? "amber" : value === "info" ? "blue" : "gray";

export default function AdminAlertsPage() {
  const ensureSession = useAuthStore((s) => s.ensureSession);
  const [tab, setTab] = useState<Tab>("channels");
  const [channels, setChannels] = useState<AlertChannel[]>([]);
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadBase = useCallback(async () => {
    setLoading(true); setError("");
    await ensureSession();
    const [channelRes, ruleRes] = await Promise.all([adminAlertApi.channels(), adminAlertApi.rules()]);
    if (!channelRes.success || !ruleRes.success) setError(channelRes.message || ruleRes.message || "告警配置加载失败");
    else { setChannels(channelRes.data ?? []); setRules(ruleRes.data ?? []); }
    setLoading(false);
  }, [ensureSession]);

  const loadEvents = useCallback(async (target = 1, filters?: { keyword?: string; level?: string; status?: string }) => {
    setLoading(true); setError(""); await ensureSession();
    const res = await adminAlertApi.events({ pageNum: target, pageSize: 30, ...filters });
    if (res.success && res.data) { setEvents(res.data.records ?? []); setTotal(res.data.total); setPage(target); }
    else setError(res.message || "告警记录加载失败");
    setLoading(false);
  }, [ensureSession]);

  useEffect(() => { const id = requestAnimationFrame(() => void loadBase()); return () => cancelAnimationFrame(id); }, [loadBase]);

  const switchTab = (next: Tab) => {
    setTab(next); setError("");
    if (next === "events") void loadEvents(1); else void loadBase();
  };

  return (
    <div className="adm-page alert-page">
      {error ? <AdminAlert tone="error" title="暂时无法加载" action={<button className="adm-btn ghost" onClick={() => tab === "events" ? loadEvents(page) : loadBase()}><RefreshCw size={14}/>重试</button>}>{error}</AdminAlert> : null}
      <div className="alert-page-head">
        <div><h1>告警通知</h1><p>将系统异常和业务风险发送给管理员，不影响用户端站内消息。</p></div>
        <div className="alert-overview" aria-label="配置概览"><span><b>{channels.filter((c) => c.enabled).length}</b> 个渠道启用</span><i/><span><b>{rules.filter((r) => r.enabled).length}</b> 条规则生效</span></div>
      </div>
      <div className="alert-tabs" role="tablist">
        {([['channels','通知渠道'],['rules','告警规则'],['events','告警记录']] as const).map(([key,label]) => <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? "active" : ""} onClick={() => switchTab(key)}>{label}</button>)}
      </div>
      {tab === "channels" ? <ChannelsTab loading={loading} channels={channels} onReload={loadBase}/> : null}
      {tab === "rules" ? <RulesTab loading={loading} rules={rules} channels={channels} onReload={loadBase}/> : null}
      {tab === "events" ? <EventsTab loading={loading} events={events} total={total} page={page} onLoad={loadEvents}/> : null}
    </div>
  );
}

function ChannelsTab({ loading, channels, onReload }: { loading: boolean; channels: AlertChannel[]; onReload: () => Promise<void> }) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [form, setForm] = useState<AlertChannelInput>(blankChannel());
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const selected = channels.find((c) => c.id === selectedId);
  const filtered = useMemo(() => channels.filter((c) => (c.name + channelNames[c.type]).toLowerCase().includes(query.toLowerCase())), [channels, query]);

  useEffect(() => {
    if (creating) return;
    const row = channels.find((c) => c.id === selectedId) ?? channels[0];
	if (!row) return;
	const frame = requestAnimationFrame(() => {
	  setSelectedId(row.id);
	  setForm({ name: row.name, type: row.type, enabled: row.enabled, minSeverity: row.minSeverity, config: { ...row.config } });
	});
	return () => cancelAnimationFrame(frame);
  }, [channels, selectedId, creating]);

  const choose = (row: AlertChannel) => { setCreating(false); setSelectedId(row.id); setForm({ name: row.name, type: row.type, enabled: row.enabled, minSeverity: row.minSeverity, config: { ...row.config } }); };
  const create = () => { setCreating(true); setSelectedId(""); setForm(blankChannel()); };
  const save = async () => {
    if (!form.name.trim()) return toast.error("请填写渠道名称");
    setSaving(true); const res = creating ? await adminAlertApi.createChannel(form) : await adminAlertApi.updateChannel(selectedId, form); setSaving(false);
    if (!res.success || !res.data) return toast.error(res.message || "保存失败");
    toast.success(creating ? "通知渠道已创建" : "通知渠道已保存"); setCreating(false); setSelectedId(res.data.id); await onReload();
  };
  const remove = async () => {
    if (!selected || !(await confirmDialog({ title: "删除通知渠道", message: `确认删除「${selected.name}」？尚未发送的投递任务也会一并取消。`, confirmText: "删除" }))) return;
    const res = await adminAlertApi.deleteChannel(selected.id); if (!res.success) return toast.error(res.message || "删除失败"); toast.success("渠道已删除"); setSelectedId(""); await onReload();
  };
  const test = async () => { if (!selected) return; setTesting(true); const res = await adminAlertApi.testChannel(selected.id); setTesting(false); if (res.success) toast.success("测试消息已发送"); else toast.error(res.message || "测试发送失败"); if (res.success) await onReload(); };

  if (loading) return <div className="alert-loading"><TableSkeleton /></div>;
  return <div className="alert-master-detail">
    <aside className="alert-channel-list">
      <div className="alert-list-tools"><div className="adm-search"><Search size={14}/><input aria-label="搜索渠道" placeholder="搜索渠道" value={query} onChange={(e) => setQuery(e.target.value)}/></div><button className="adm-btn icon" aria-label="新增渠道" onClick={create}><Plus size={15}/></button></div>
      <div className="alert-list-scroll">
        {filtered.map((row) => <button key={row.id} className={`alert-channel-row ${row.id === selectedId && !creating ? "active" : ""}`} onClick={() => choose(row)}>
          <span className="alert-channel-mark"><BellRing size={16}/></span><span className="alert-channel-copy"><b>{row.name}</b><small>{channelNames[row.type]}</small></span>
          <span className={`alert-health ${row.enabled && row.configured ? "ok" : "off"}`} title={row.enabled && row.configured ? "已启用" : "未启用或未配置"}/><ChevronRight size={14}/>
        </button>)}
        {!filtered.length ? <div className="alert-list-empty">{query ? "没有匹配的渠道" : "尚未配置通知渠道"}</div> : null}
      </div>
      <div className="alert-list-foot"><button className="adm-btn ghost" onClick={create}><Plus size={14}/>添加通知渠道</button></div>
    </aside>
    <section className="alert-channel-editor">
      {creating || selected ? <>
        <header className="alert-editor-head"><div><h2>{creating ? "添加通知渠道" : selected?.name}</h2><p>{creating ? "配置一个新的管理员通知目的地" : `${channelNames[selected!.type]} · ${selected!.configured ? "连接信息完整" : "等待完成配置"}`}</p></div><div className="alert-editor-state"><span>启用</span><SwitchToggle checked={form.enabled} onChange={(enabled) => setForm((f) => ({ ...f, enabled }))}/></div></header>
        <div className="alert-form-section"><h3>基本信息</h3><div className="alert-form-grid"><label><span>渠道名称</span><input value={form.name} placeholder="如：运维告警群" onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}/></label><label><span>渠道类型</span><select value={form.type} disabled={!creating} onChange={(e) => setForm({ ...blankChannel(), name: form.name, enabled: form.enabled, type: e.target.value as AlertChannelInput['type'] })}><option value="feishu">飞书机器人</option><option value="dingtalk">钉钉机器人</option><option value="telegram">Telegram Bot</option></select></label></div></div>
        <div className="alert-form-section"><h3>连接配置</h3>{form.type !== "telegram" ? <div className="alert-form-grid single"><label><span>Webhook 地址</span><input type="password" autoComplete="new-password" value={form.config.webhook ?? ""} placeholder="https://…" onChange={(e) => setForm((f) => ({ ...f, config: { ...f.config, webhook: e.target.value } }))}/><small>仅允许该平台官方 HTTPS 域名，保存后加密存储。</small></label><label><span>签名密钥 <em>可选</em></span><input type="password" autoComplete="new-password" value={form.config.secret ?? ""} placeholder="未启用签名可留空" onChange={(e) => setForm((f) => ({ ...f, config: { ...f.config, secret: e.target.value } }))}/></label></div> : <div className="alert-form-grid"><label><span>Bot Token</span><input type="password" autoComplete="new-password" value={form.config.botToken ?? ""} onChange={(e) => setForm((f) => ({ ...f, config: { ...f.config, botToken: e.target.value } }))}/></label><label><span>Chat ID</span><input type="password" autoComplete="new-password" value={form.config.chatId ?? ""} onChange={(e) => setForm((f) => ({ ...f, config: { ...f.config, chatId: e.target.value } }))}/></label><label><span>Topic ID <em>可选</em></span><input value={form.config.threadId ?? ""} onChange={(e) => setForm((f) => ({ ...f, config: { ...f.config, threadId: e.target.value } }))}/></label></div>}</div>
        <div className="alert-form-section"><h3>投递策略</h3><div className="alert-form-grid"><label><span>最低告警级别</span><select value={form.minSeverity} onChange={(e) => setForm((f) => ({ ...f, minSeverity: e.target.value as AlertSeverity }))}>{severities.map((s) => <option key={s.value} value={s.value}>{s.label}及以上</option>)}</select><small>低于该级别的事件不会发送到此渠道。</small></label></div></div>
        {!creating && selected?.lastError ? <AdminAlert tone="error" title="最近一次投递失败">{selected.lastError} · {fmtTime(selected.lastFailureAt)}</AdminAlert> : null}
        <footer className="alert-editor-foot"><div>{!creating ? <button className="adm-btn ghost danger-text" onClick={remove}><Trash2 size={14}/>删除</button> : null}</div><div><button className="adm-btn ghost" disabled={creating || testing} onClick={test}><Send size={14}/>{testing ? "发送中…" : "发送测试"}</button><button className="adm-btn" disabled={saving} onClick={save}><Check size={14}/>{saving ? "保存中…" : "保存设置"}</button></div></footer>
      </> : <AdminEmptyState title="尚未配置通知渠道" description="添加飞书、钉钉或 Telegram，系统会向所有启用且命中规则的渠道发送通知。" action={<button className="adm-btn" onClick={create}><Plus size={15}/>添加渠道</button>}/>}
    </section>
  </div>;
}

function RulesTab({ loading, rules, channels, onReload }: { loading: boolean; rules: AlertRule[]; channels: AlertChannel[]; onReload: () => Promise<void> }) {
  const [editing, setEditing] = useState<AlertRule | null>(null); const [open, setOpen] = useState(false); const [form, setForm] = useState<AlertRuleInput>(blankRule()); const [saving, setSaving] = useState(false);
  const show = (row?: AlertRule) => { setEditing(row ?? null); setForm(row ? { name:row.name,enabled:row.enabled,eventPatterns:[...row.eventPatterns],minSeverity:row.minSeverity,channelIds:[...row.channelIds],cooldownSeconds:row.cooldownSeconds,aggregateSeconds:row.aggregateSeconds,sendRecovery:row.sendRecovery } : blankRule()); setOpen(true); };
  const save = async () => { if (!form.name.trim()) return toast.error("请填写规则名称"); setSaving(true); const res=editing?await adminAlertApi.updateRule(editing.id,form):await adminAlertApi.createRule(form);setSaving(false);if(!res.success)return toast.error(res.message||"保存失败");toast.success("告警规则已保存");setOpen(false);await onReload(); };
  const remove = async (row: AlertRule) => { if(!(await confirmDialog({title:"删除告警规则",message:`确认删除「${row.name}」？`,confirmText:"删除"})))return;const res=await adminAlertApi.deleteRule(row.id);if(!res.success)return toast.error(res.message||"删除失败");toast.success("规则已删除");await onReload(); };
  return <Panel title="告警规则" sub="按事件类型、级别和冷却时间控制通知范围" tools={<button className="adm-btn" onClick={() => show()}><Plus size={15}/>新增规则</button>}>
    {loading?<TableSkeleton/>:<AdminTable rows={rules} rowKey={(r)=>r.id} label="告警规则列表" columns={[
      {header:"规则",className:"strong",cell:(r)=><div>{r.name}<div className="muted mono alert-cell-sub">{r.eventPatterns.join(" · ")}</div></div>},
      {header:"最低级别",cell:(r)=><StatusPill tone={severityTone(r.minSeverity)}>{severityLabel(r.minSeverity)}</StatusPill>},
      {header:"通知渠道",className:"muted",cell:(r)=>r.channelIds.length?`${r.channelIds.length} 个指定渠道`:"全部启用渠道"},
      {header:"冷却时间",className:"muted",cell:(r)=>`${r.cooldownSeconds} 秒`},
      {header:"状态",cell:(r)=><StatusPill tone={r.enabled?"green":"gray"}>{r.enabled?"启用":"停用"}</StatusPill>},
      {header:"操作",align:"right",cell:(r)=><RowActions actions={[{label:"编辑",onClick:()=>show(r)},{label:"删除",onClick:()=>remove(r)}]}/>},
    ]}/>}
    <AdminModal open={open} title={editing?"编辑告警规则":"新增告警规则"} subtitle="同一事件在冷却期内只累计次数，不重复打扰" onClose={()=>setOpen(false)} onSave={save} saveLabel={saving?"保存中…":"保存规则"}>
      <FormCard title="匹配与路由"><FormGrid>
        <Field label="规则名称" required span={4}><input value={form.name} onChange={(e)=>setForm((f)=>({...f,name:e.target.value}))}/></Field>
        <Field label="事件类型" required span={4} hint="每行一个；支持 * 和 ai.* 这样的前缀匹配"><textarea rows={4} value={form.eventPatterns.join("\n")} onChange={(e)=>setForm((f)=>({...f,eventPatterns:e.target.value.split(/\n+/).map((v)=>v.trim()).filter(Boolean)}))}/></Field>
        <Field label="最低级别" span={2}><select value={form.minSeverity} onChange={(e)=>setForm((f)=>({...f,minSeverity:e.target.value as AlertSeverity}))}>{severities.map((s)=><option key={s.value} value={s.value}>{s.label}</option>)}</select></Field>
        <Field label="冷却时间（秒）" span={2}><input type="number" min={0} max={86400} value={form.cooldownSeconds} onChange={(e)=>setForm((f)=>({...f,cooldownSeconds:Number(e.target.value)}))}/></Field>
        <Field label="聚合等待（秒）" span={4} hint="等待期间持续累计同类事件；0 表示立即发送"><input type="number" min={0} max={86400} value={form.aggregateSeconds} onChange={(e)=>setForm((f)=>({...f,aggregateSeconds:Number(e.target.value)}))}/></Field>
        <Field label="通知渠道" span={4} hint="不选择代表发送到全部已启用渠道"><div className="alert-check-list">{channels.map((c)=><label key={c.id}><input type="checkbox" checked={form.channelIds.includes(c.id)} onChange={(e)=>setForm((f)=>({...f,channelIds:e.target.checked?[...f.channelIds,c.id]:f.channelIds.filter((id)=>id!==c.id)}))}/><span>{c.name}</span><small>{channelNames[c.type]}</small></label>)}</div></Field>
        <Field label="规则状态" span={2}><div className="alert-switch-line"><SwitchToggle checked={form.enabled} onChange={(enabled)=>setForm((f)=>({...f,enabled}))}/><span>{form.enabled?"启用":"停用"}</span></div></Field>
        <Field label="恢复通知" span={2}><div className="alert-switch-line"><SwitchToggle checked={form.sendRecovery} onChange={(sendRecovery)=>setForm((f)=>({...f,sendRecovery}))}/><span>{form.sendRecovery?"发送":"不发送"}</span></div></Field>
      </FormGrid></FormCard>
    </AdminModal>
  </Panel>;
}

function EventsTab({ loading, events, total, page, onLoad }: { loading:boolean;events:AlertEvent[];total:number;page:number;onLoad:(page:number,filters?:{keyword?:string;level?:string;status?:string})=>Promise<void> }) {
  const [query,setQuery]=useState("");const [level,setLevel]=useState("");const [status,setStatus]=useState("");const [selected,setSelected]=useState<AlertEvent|null>(null);const [deliveries,setDeliveries]=useState<AlertDelivery[]>([]);const [deliveryLoading,setDeliveryLoading]=useState(false);
  const filters=useMemo(()=>({keyword:query.trim()||undefined,level:level||undefined,status:status||undefined}),[query,level,status]);
  const inspect=async(row:AlertEvent)=>{setSelected(row);setDeliveryLoading(true);const res=await adminAlertApi.deliveries(row.id);setDeliveries(res.success?res.data??[]:[]);setDeliveryLoading(false)};
  const retry=async(id:string)=>{const res=await adminAlertApi.retryDelivery(id);if(!res.success)return toast.error(res.message||"重试失败");toast.success("已重新加入投递队列");if(selected)await inspect(selected)};
  return <Panel title="告警记录" sub="查看事件聚合、恢复状态和每个渠道的投递结果" tools={<form className="alert-event-filters" onSubmit={(e)=>{e.preventDefault();void onLoad(1,filters)}}><div className="adm-search"><Search size={14}/><input aria-label="搜索告警" placeholder="标题 / 事件类型" value={query} onChange={(e)=>setQuery(e.target.value)}/></div><select aria-label="告警级别" value={level} onChange={(e)=>setLevel(e.target.value)}><option value="">全部级别</option>{severities.map((s)=><option key={s.value} value={s.value}>{s.label}</option>)}</select><select aria-label="告警状态" value={status} onChange={(e)=>setStatus(e.target.value)}><option value="">全部状态</option><option value="firing">处理中</option><option value="resolved">已恢复</option></select><button className="adm-btn ghost" type="submit">筛选</button></form>}>
    {loading?<TableSkeleton/>:events.length?<AdminTable rows={events} rowKey={(r)=>r.id} label="告警事件列表" server={{page,pageSize:30,total,onPage:(p)=>onLoad(p,filters)}} columns={[
      {header:"事件",className:"strong",cell:(r)=><button className="alert-event-title" onClick={()=>inspect(r)}>{r.title}<small>{r.eventType}</small></button>},
      {header:"级别",cell:(r)=><StatusPill tone={severityTone(r.severity)}>{severityLabel(r.severity)}</StatusPill>},
      {header:"状态",cell:(r)=><StatusPill tone={r.state==="resolved"?"green":"amber"}>{r.state==="resolved"?"已恢复":"处理中"}</StatusPill>},
      {header:"次数",className:"muted",cell:(r)=>r.occurrenceCount},
      {header:"最近发生",className:"muted mono",cell:(r)=>fmtTime(r.lastOccurredAt)},
      {header:"操作",align:"right",cell:(r)=><button className="adm-btn ghost small" onClick={()=>inspect(r)}>查看</button>},
    ]}/>:<AdminEmptyState title="暂无告警记录" description="系统异常、余额不足或支付风险出现后，会在这里形成可追踪的事件记录。"/>}
    <AdminDrawer open={!!selected} title={selected?.title??"告警详情"} extra={selected?<StatusPill tone={selected.state==="resolved"?"green":"amber"}>{selected.state==="resolved"?"已恢复":"处理中"}</StatusPill>:null} onClose={()=>setSelected(null)}>
      {selected?<div className="alert-drawer"><div className="alert-drawer-summary"><StatusPill tone={severityTone(selected.severity)}>{severityLabel(selected.severity)}</StatusPill><span className="mono">{selected.eventType}</span><span>累计 {selected.occurrenceCount} 次</span></div><p className="alert-drawer-content">{selected.content}</p><dl><div><dt>来源</dt><dd>{selected.source||"—"}</dd></div><div><dt>环境 / 实例</dt><dd>{selected.environment} · {selected.instanceId}</dd></div><div><dt>首次发生</dt><dd>{fmtTime(selected.firstOccurredAt)}</dd></div><div><dt>最近发生</dt><dd>{fmtTime(selected.lastOccurredAt)}</dd></div>{Object.entries(selected.details).map(([k,v])=><div key={k}><dt>{k}</dt><dd>{String(v)}</dd></div>)}</dl><h3>投递记录</h3>{deliveryLoading?<TableSkeleton rows={3}/>:deliveries.length?<div className="alert-deliveries">{deliveries.map((d)=><div key={d.id}><span className="alert-channel-mark"><BellRing size={14}/></span><div><b>{d.channelName||"已删除渠道"}</b><small>{channelNames[d.channelType]??d.channelType} · 尝试 {d.attemptCount} 次</small>{d.errorMessage?<em>{d.errorMessage}</em>:null}</div><StatusPill tone={d.status==="sent"?"green":d.status==="failed"?"red":"amber"}>{d.status==="sent"?"已发送":d.status==="failed"?"失败":"等待重试"}</StatusPill>{d.status==="failed"?<button className="adm-btn ghost small" onClick={()=>retry(d.id)}>重试</button>:null}</div>)}</div>:<p className="muted">该事件没有匹配到已启用的通知渠道。</p>}</div>:null}
    </AdminDrawer>
  </Panel>;
}
