"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AudioLines, Check, Copy, ExternalLink, ImageIcon, LoaderCircle, Network, RefreshCw, Save, ShieldCheck, Video } from "lucide-react";
import { Field, FormCard, SectionHeader, SwitchToggle } from "@/components/admin";
import { mcpClientConfig, mcpConfigApi, mcpServiceState, type MCPConfig, type MCPSettings, type MCPStatus } from "@/lib/mcp-config-api";
import { toast } from "@/components/shared/toast";
import styles from "./page.module.css";

const subscribe = () => () => {};
const browserOrigin = () => window.location.origin;
const initialOrigin = () => "https://你的主站域名";
const media = [
  { key: "imageEnabled", title: "图片生成", tool: "generate_image", text: "文生图与图生图", icon: ImageIcon },
  { key: "videoEnabled", title: "视频生成", tool: "generate_video", text: "文生、图生、首尾帧与全能参考", icon: Video },
  { key: "audioEnabled", title: "音频生成", tool: "generate_audio", text: "音乐、音效与语音", icon: AudioLines },
] as const;

function editable(config: MCPConfig): MCPSettings {
  return { enabled:config.enabled, imageEnabled:config.imageEnabled, videoEnabled:config.videoEnabled, audioEnabled:config.audioEnabled, publicUrl:config.publicUrl, allowedOrigins:config.allowedOrigins, pollIntervalSeconds:config.pollIntervalSeconds };
}

export default function MCPAdminPage() {
  const origin = useSyncExternalStore(subscribe,browserOrigin,initialOrigin);
  const [saved,setSaved] = useState<MCPConfig | null>(null);
  const [draft,setDraft] = useState<MCPSettings | null>(null);
  const [originsText,setOriginsText] = useState("");
  const [status,setStatus] = useState<MCPStatus | null>(null);
  const [error,setError] = useState("");
  const [loading,setLoading] = useState(true);
  const [saving,setSaving] = useState(false);
  const [checking,setChecking] = useState(false);
  const [copied,setCopied] = useState(false);
  const alive = useRef(false);
  const checkLock = useRef(false);
  const saveLock = useRef(false);
  const loadVersion = useRef(0);
  const followup = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requests = useRef(new Set<AbortController>());
  const startRequest = useCallback(() => {
    const controller=new AbortController();
    requests.current.add(controller);
    const deadline=setTimeout(() => controller.abort(),15000);
    return { signal:controller.signal, finish:() => {clearTimeout(deadline);requests.current.delete(controller);} };
  },[]);

  const apply = useCallback((data: MCPConfig) => {
    setSaved(data); setDraft(editable(data)); setOriginsText((data.allowedOrigins ?? []).join("\n")); setCopied(false);
  },[]);

  const checkStatus = useCallback(async () => {
    if (checkLock.current) return;
    checkLock.current = true; setChecking(true);
    const request=startRequest();
    try {
      const res = await mcpConfigApi.status(request.signal);
      if (!alive.current) return;
      if (request.signal.aborted) {setStatus(null);toast.error("连接检测超时，请稍后重试");return;}
      if (!res.success || !res.data) { setStatus(null); toast.error(res.message || "检测失败，请稍后重试"); return; }
      setStatus(res.data);
    } catch { if (alive.current) toast.error("暂时无法检测 MCP 服务"); }
    finally {request.finish(); checkLock.current=false; if (alive.current) setChecking(false); }
  },[startRequest]);

  const load = useCallback(async () => {
    const version=++loadVersion.current;
    setLoading(true); setError("");
    const request=startRequest();
    try {
      const res=await mcpConfigApi.get(request.signal);
      if (!alive.current || version!==loadVersion.current) return;
      if (request.signal.aborted) {setError("读取配置超时，请重试");return;}
      if (!res.success || !res.data) {setError(res.message || "MCP 配置读取失败，请确认主站已更新");return;}
      apply(res.data); void checkStatus();
    } catch {if (alive.current && version===loadVersion.current) setError("配置读取失败，请稍后重试");}
    finally {request.finish();if (alive.current && version===loadVersion.current) setLoading(false);}
  },[apply,checkStatus,startRequest]);

  useEffect(() => {
    alive.current=true;
    const pendingRequests=requests.current;
    const timer=setTimeout(() => void load(),0);
    return () => {
      alive.current=false;
      // This ref is a request sequence counter, not a DOM element.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      loadVersion.current++;
      for (const request of pendingRequests) request.abort();
      clearTimeout(timer);if(followup.current)clearTimeout(followup.current);
    };
  },[load]);

  const settings = draft ? { ...draft, allowedOrigins:originsText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) } : null;
  const dirty = !!(settings && saved && JSON.stringify(settings)!==JSON.stringify(editable(saved)));
  const service = mcpServiceState(status,saved?.revision ?? 0);
  const endpoint = saved?.publicUrl || `${origin}/mcp`;
  const configText = JSON.stringify(mcpClientConfig(saved?.publicUrl ?? "",origin),null,2);
  const change = <K extends keyof MCPSettings>(key: K,value: MCPSettings[K]) => setDraft((prev) => prev ? { ...prev,[key]:value } : prev);

  const save = async () => {
    if (!settings || !saved || saveLock.current) return;
    if (!Number.isInteger(settings.pollIntervalSeconds) || settings.pollIntervalSeconds<3 || settings.pollIntervalSeconds>60) {toast.error("轮询间隔应为 3–60 秒的整数");return;}
    saveLock.current=true;setSaving(true);setError("");
    const request=startRequest();
    try {
      const res=await mcpConfigApi.save({ ...settings,revision:saved.revision },request.signal);
      if (!alive.current) return;
      if (request.signal.aborted || res.code===0) {setError("保存结果暂时无法确认，请重新加载核对；不会自动重复保存");return;}
      if (!res.success || !res.data) {setError(res.message || "保存失败");return;}
      apply(res.data);toast.success("配置已保存，后续 MCP 请求约 5 秒内生效");
      if (followup.current) clearTimeout(followup.current);
      followup.current=setTimeout(() => void checkStatus(),5500);
    } catch {if (alive.current) setError("保存失败，请重新加载核对配置后再试");}
    finally {request.finish();saveLock.current=false;if (alive.current) setSaving(false);}
  };

  return <div className={styles.page}>
    <SectionHeader title="MCP 配置" sub="将主站生成能力提供给 AI 客户端，统一管理接入与使用范围。" tools={<>
      <Link className="adm-btn ghost" href="/api-docs#mcp" target="_blank" rel="noreferrer"><ExternalLink size={14}/>接入文档</Link>
      <button className="adm-btn ghost" disabled={loading || saving} onClick={() => void load()}><RefreshCw size={14}/>重新加载</button>
      <button className="adm-btn" disabled={!dirty || saving || loading} onClick={() => void save()}>{saving ? <LoaderCircle className="adm-spin" size={14}/> : <Save size={14}/>} {saving ? "保存中…" : "保存配置"}</button>
    </>}/>
    {error && <div className={styles.error} role="alert">{error}</div>}
    {loading ? <div className={styles.empty} role="status"><LoaderCircle className="adm-spin" size={20}/>正在读取配置…</div> : !draft || !saved ? <div className={styles.empty}><p>暂时无法载入 MCP 配置</p><button className="adm-btn ghost" onClick={() => void load()}>重试</button></div> : <>
      <section className={styles.overview}>
        <div className={styles.serviceName}><span className={styles.serviceIcon}><Network size={24}/></span><div><span className={styles.eyebrow}>FLOWLIGHT · MCP</span><h2>生成能力接入服务</h2><p>Streamable HTTP / stdio</p></div></div>
        <div className={styles.status}><span className={`${styles.statusPill} ${styles[service.tone]}`}>{service.label}</span><span>{status ? `检测于 ${new Date(status.checkedAt).toLocaleTimeString()} · ${status.latencyMs} ms` : "运行状态以连接检测结果为准"}</span></div>
        <button type="button" className="adm-btn ghost" disabled={checking} onClick={() => void checkStatus()}>{checking ? <LoaderCircle className="adm-spin" size={14}/> : <RefreshCw size={14}/>} {checking ? "检测中…" : "检测连接"}</button>
      </section>
      <div className={styles.grid}>
        <div className={styles.main}>
          <FormCard title="接入设置">
            <div className={styles.toggleRow}><div><strong>允许 MCP 接入</strong><p>关闭后拒绝新的 MCP 调用，已受理的生成任务继续在主站执行。</p></div><SwitchToggle checked={draft.enabled} disabled={saving} onChange={(v) => change("enabled",v)} aria-label="允许 MCP 接入"/></div>
            <div className={styles.fields}>
              <Field label="对外接入地址" hint="用于生成客户端配置。域名与反向代理需已部署；留空使用当前主站域名加 /mcp。"><input type="url" value={draft.publicUrl} placeholder={`${origin}/mcp`} disabled={saving} onChange={(e) => change("publicUrl",e.target.value)}/></Field>
              <Field label="建议轮询间隔（秒）" hint="3–60 秒，返回给客户端作为查询任务的等待时间。"><input type="number" min={3} max={60} step={1} value={draft.pollIntervalSeconds || ""} disabled={saving} onChange={(e) => change("pollIntervalSeconds",Number(e.target.value))}/></Field>
            </div>
          </FormCard>
          <FormCard title="开放的生成能力"><p className={styles.note}>关闭的能力会从工具列表隐藏，并拒绝直接调用。计费仍使用后台模型的积分规则。</p>
            {media.map(({key,title,tool,text,icon:Icon}) => <div className={styles.mediaRow} key={key}><span className={styles.mediaIcon}><Icon size={20}/></span><div><strong>{title}</strong><p>{text}</p><code>{tool}</code></div><SwitchToggle checked={draft[key]} disabled={saving} onChange={(v) => change(key,v)} aria-label={`开放${title}`}/></div>)}
            <p className={styles.note}>模型、任务、历史与余额查询随总开关开放，不单独收费。</p>
          </FormCard>
          <FormCard title="允许的浏览器来源"><Field label="来源列表" hint="每行一个 origin，例如 https://example.com，不带路径或通配符。首次保存后以本列表替代环境默认白名单；通过反向代理接入的网页请显式填写来源。留空不开放跨域来源，原生 MCP 客户端不受影响。"><textarea rows={4} value={originsText} placeholder={origin} disabled={saving} spellCheck={false} onChange={(e) => setOriginsText(e.target.value)}/></Field></FormCard>
        </div>
        <aside className={styles.side}>
          <section className={styles.connectCard}><h3><ShieldCheck size={17}/>客户端配置</h3><p>使用已保存的地址。每位用户填写自己在个人中心获取的 API Key。</p><code className={styles.endpoint}>{endpoint}</code><pre>{configText}</pre><button type="button" className="adm-btn ghost" onClick={async () => {try{await navigator.clipboard.writeText(configText);setCopied(true);}catch{toast.error("复制失败，请手动选择配置内容复制");}}}>{copied ? <Check size={14}/> : <Copy size={14}/>} {copied ? "已复制" : "复制已保存配置"}</button></section>
          <section className={styles.runtime}><h3>运行状态</h3><dl><div><dt>接入策略</dt><dd>{saved.enabled ? "已启用" : "已停用"}</dd></div><div><dt>保存版本</dt><dd>{saved.configured ? `v${saved.revision}` : "默认配置"}</dd></div><div><dt>服务版本</dt><dd>{status?.version || "—"}</dd></div><div><dt>已同步版本</dt><dd>{status?.policyAvailable ? `v${status.policyRevision}` : "—"}</dd></div><div><dt>最近保存</dt><dd>{saved.updatedAt ? new Date(saved.updatedAt).toLocaleString() : "尚未保存"}</dd></div></dl><p>{status?.message || "点击检测连接，读取 MCP 服务的实际状态。"}</p>{status?.internalUrl && <p>内部检测地址：<code>{status.internalUrl}</code></p>}<p>检测地址来自主站部署变量 TIDECANVAS_MCP_INTERNALURL，默认本机 8082。进程监听地址和主站连接地址仍在 MCP 部署环境中设置。</p></section>
        </aside>
      </div>
      <div className={styles.saveBar}><span>{dirty ? "有尚未保存的修改" : "当前显示已保存配置"} · 保存后服务约 5 秒内自动读取</span><button className="adm-btn" disabled={!dirty || saving} onClick={() => void save()}>{saving ? "保存中…" : "保存配置"}</button></div>
    </>}
  </div>;
}
