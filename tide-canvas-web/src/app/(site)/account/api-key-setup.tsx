"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { ArrowUpRight, Check, Copy, Download, Loader2, Terminal, X } from "lucide-react";
import { useFocusTrap } from "@/hooks/use-focus-trap";
import { PopoverSelect } from "@/components/shared/popover-select";
import { getAccessToken } from "@/lib/http";
import { useAuthStore } from "@/stores/use-auth-store";
import { agentConfig, agentConfigPath, agentModels, agentTerminal, ccSwitchLink, gatewayBase, type AgentClient, type AgentModel, type AgentShell } from "@/lib/agent-setup";
import "./api-key-setup.css";

const clients = [{id:"codex",label:"Codex CLI"},{id:"opencode",label:"OpenCode"}] as const;
const shells = [{id:"posix",label:"macOS / Linux"},{id:"powershell",label:"PowerShell"},{id:"cmd",label:"Windows CMD"}] as const;
export function ApiKeySetup({ accountId, secret, mode, onModeChange, onClose }: { accountId: string; secret: string; mode: "manual" | "ccswitch"; onModeChange: (mode: "manual" | "ccswitch") => void; onClose: () => void }) {
  const dialog = useFocusTrap<HTMLDivElement>(true);
  const titleId = useId(), descriptionId = useId(), modelId = useId(), panelId = useId();
  const [client,setClient] = useState<AgentClient>("codex");
  const [shell,setShell] = useState<AgentShell>(()=>typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent) ? "powershell" : "posix");
  const [selected,setSelected] = useState("");
  const [models,setModels] = useState<AgentModel[]>([]);
  const [loading,setLoading] = useState(true), [loadError,setLoadError] = useState("");
  const [revision,setRevision] = useState(0), [error,setError] = useState(""), [notice,setNotice] = useState("");
  const [copied,setCopied] = useState("");
  const [ownerToken] = useState(()=>getAccessToken());
  const [origin] = useState(()=>window.location.origin);
  const alive = useRef(false), copying = useRef(false), lastImport = useRef(-Infinity), backdropPress = useRef(false);
  const isOwner = () => alive.current && !!ownerToken && getAccessToken() === ownerToken && useAuthStore.getState().user?.id === accountId;
  const model = models.find(row=>row.id===selected)?.id || models[0]?.id || "";

  useEffect(()=>{
    alive.current=true;
    const previous = document.body.style.overflow;
    document.body.style.overflow="hidden";
    return ()=>{alive.current=false;document.body.style.overflow=previous;};
  },[]);
  useEffect(()=>{
    const controller = new AbortController();
    const timer = setTimeout(()=>controller.abort(),15000);
    let cancelled=false;
    async function load() {
      try {
        const response=await fetch("/api/integrations/v1/models",{ headers:{Authorization:`Bearer ${secret}`},signal:controller.signal,credentials:"omit",cache:"no-store",redirect:"error" });
        if(!response.ok) throw new Error("模型列表暂时无法读取，请重试；如果密钥已停用，请先启用。");
        const result=agentModels(await response.json());
        if(!cancelled) {
          if(getAccessToken()===ownerToken && useAuthStore.getState().user?.id===accountId) setModels(result);
          else setLoadError("登录状态已变化，请关闭弹窗并刷新页面。");
        }
      } catch {
        if(!cancelled) setLoadError("模型列表暂时无法读取，请重试；如果密钥已停用，请先启用。");
      } finally { clearTimeout(timer); if(!cancelled)setLoading(false); }
    }
    void load();return ()=>{cancelled=true;clearTimeout(timer);controller.abort();};
  },[secret,ownerToken,accountId,revision]);

  const retry=()=>{setModels([]);setLoading(true);setLoadError("");setRevision(value=>value+1);};
  const switchClient=(value:AgentClient)=>{setClient(value);setCopied("");setNotice("");setError("");};
  const dialogKeys=(event:KeyboardEvent<HTMLDivElement>)=>{
    if(event.key!=="Escape"||event.defaultPrevented)return;
    event.stopPropagation();
    // The trigger can still own focus during the menu's opening frame or
    // after Shift+Tab. Close its popup before dismissing the whole dialog.
    const openSelect=event.currentTarget.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"][aria-expanded="true"]');
    if(openSelect){event.preventDefault();openSelect.click();openSelect.focus();return;}
    onClose();
  };
  const tabKeys=(event:KeyboardEvent<HTMLDivElement>)=>{
    if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;
    const tabs=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    const index=tabs.indexOf(event.target as HTMLButtonElement);if(index<0)return;
    event.preventDefault();const next=event.key==="Home"?0:event.key==="End"?tabs.length-1:(index+(event.key==="ArrowRight"?1:-1)+tabs.length)%tabs.length;
    tabs[next].focus();tabs[next].click();
  };
  const copy=async(text:string)=>{
    if(!isOwner()){setCopied("");setError("登录状态已变化，请关闭弹窗并刷新页面。");return;}
    if(copying.current)return;copying.current=true;setError("");setCopied("");
    try{await navigator.clipboard.writeText(text);if(isOwner())setCopied(text);}
    catch{if(isOwner())setError("复制失败，请手动选中下方内容复制。");}
    finally{copying.current=false;}
  };
  const launch=(event: MouseEvent<HTMLButtonElement>)=>{
    if(!isOwner()){setError("登录状态已变化，请关闭弹窗并刷新页面。");return;}
    if(!model || loading || event.timeStamp-lastImport.current<1000)return;
    try{
      const link=document.createElement("a");link.href=ccSwitchLink(client,origin,model,secret);link.rel="noreferrer";link.click();
      lastImport.current=event.timeStamp;setError("");setNotice("已请求打开 CC Switch，请在客户端核对并确认导入。网页无法判断是否已完成导入。");
    }catch{setError("未能打开 CC Switch，请确认已安装并至少启动过一次，也可以改用手动配置。");}
  };
  const copyBlock=(label:string,text:string)=> <section className="key-setup-code"><header><span>{label}</span><button type="button" onClick={()=>void copy(text)}>{copied===text?<Check size={14}/>:<Copy size={14}/>}<span>{copied===text?"已复制":"复制"}</span></button></header><pre tabIndex={0}><code>{text}</code></pre></section>;
  let config="",terminal="";
  try{if(model){terminal=agentTerminal(client,shell,secret);config=agentConfig(client,origin,model);}}catch{/* Invalid credentials cannot produce executable instructions. */}

  return createPortal(<div className="key-setup-overlay" onPointerDown={event=>{backdropPress.current=event.target===event.currentTarget;}} onPointerCancel={()=>{backdropPress.current=false;}} onClick={event=>{if(backdropPress.current && event.target===event.currentTarget)onClose();backdropPress.current=false;}}>
    <div ref={dialog} className="key-setup-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} tabIndex={-1} onKeyDown={dialogKeys}>
      <header className="key-setup-heading"><div><Terminal size={20}/><h2 id={titleId}>{mode==="manual"?"使用 API 密钥":"导入到 CC Switch"}</h2></div><button type="button" aria-label="关闭密钥配置" onClick={onClose}><X size={20}/></button></header>
      <div className="key-setup-body"><p id={descriptionId}>{mode==="manual"?"选择客户端和系统，复制配置后即可使用当前账号的密钥。":"将本站地址、当前账号的密钥和所选模型添加到 CC Switch。"}</p>
        <div className="key-setup-tabs" role="tablist" aria-label="选择客户端" onKeyDown={tabKeys}>{clients.map(item=><button type="button" role="tab" key={item.id} id={`${panelId}-${item.id}`} aria-controls={panelId} aria-selected={client===item.id} tabIndex={client===item.id?0:-1} onClick={()=>switchClient(item.id)}>{item.label}</button>)}</div>
        <div id={panelId} role="tabpanel" aria-labelledby={`${panelId}-${client}`}>
          <div className="key-setup-model"><label htmlFor={modelId}>使用模型</label>{loading?<p role="status"><Loader2 size={15} className="animate-spin"/>正在读取可用模型…</p>:loadError?<p role="alert">{loadError} <button type="button" onClick={retry}>重试</button></p>:models.length?<PopoverSelect id={modelId} label="使用模型" value={model} options={models.map(item=>({value:item.id,label:`${item.name} · ${item.id}`}))} onChange={value=>{setSelected(value);setCopied("");setNotice("");}}/>:<p role="status">暂时没有可用的对话模型，请联系管理员配置。<Link href="/api-docs#chat">查看接口说明</Link></p>}</div>
          <dl className="key-setup-endpoint"><dt>Base URL</dt><dd><code>{gatewayBase(origin)}</code><button type="button" aria-label="复制 Base URL" onClick={()=>void copy(gatewayBase(origin))}>{copied===gatewayBase(origin)?<><Check size={14}/><span>已复制</span></>:<Copy size={14}/>}</button></dd></dl>
          {mode==="manual" && !!config && <>
            <div className="key-setup-tabs small" role="group" aria-label="终端系统">{shells.map(item=><button type="button" key={item.id} aria-pressed={shell===item.id} onClick={()=>{setShell(item.id);setCopied("");}}>{item.label}</button>)}</div>
            <h3>合并客户端配置</h3><p className="key-setup-help">打开 <code>{agentConfigPath(client,shell)}</code>，合并以下字段；文件不存在时可新建，已有配置请保留其他内容。</p>
            {copyBlock(client==="codex"?"config.toml":"opencode.json",config)}
            <h3>在终端启动</h3><p className="key-setup-help">先安装 {client==="codex"?"Codex CLI":"OpenCode"}，再在项目目录运行。密钥仅在当前终端会话有效，新开终端需要重新设置。</p>{copyBlock("Terminal",terminal)}
          </>}
          {mode==="ccswitch" && <div className="key-setup-import"><h3>在客户端确认后生效</h3><p>需要先安装并启动 CC Switch。点击下方按钮后，允许浏览器打开应用，再核对地址、密钥和模型。</p><p>是否立即切换由 CC Switch 中的选项决定。重复导入可能新增一份配置。</p><a href="https://github.com/farion1231/cc-switch/releases" target="_blank" rel="noopener noreferrer"><Download size={14}/>下载 CC Switch<ArrowUpRight size={13}/></a></div>}
          {!!model&&!config && <p role="alert" className="key-setup-error">密钥配置无效，请关闭弹窗并重新读取。</p>}
          {error&&<p role="alert" className="key-setup-error">{error}</p>}{notice&&<p role="status" className="key-setup-notice">{notice}</p>}
          <p className="key-setup-help">配置使用你当前访问的站点地址。模型调用按实际 Token 用量计费；读取模型列表不会生成内容。</p>
        </div>
      </div>
      <div className="key-setup-footer"><Link href="/api-docs#chat">查看完整接入文档<ArrowUpRight size={13}/></Link><div><button type="button" onClick={()=>{setNotice("");setError("");onModeChange(mode==="manual"?"ccswitch":"manual");}}>{mode==="manual"?"导入到 CC Switch":"改用手动配置"}</button><button type="button" onClick={onClose}>关闭</button>{mode==="ccswitch"&&<button type="button" className="primary" disabled={loading||!!loadError||!config} onClick={launch}>{notice?"重新打开 CC Switch":"打开 CC Switch 导入"}<ArrowUpRight size={15}/></button>}</div></div>
    </div>
  </div>,document.body);
}
