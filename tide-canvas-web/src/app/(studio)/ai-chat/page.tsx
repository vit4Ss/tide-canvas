"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, ExternalLink, Loader2, MessageSquare, Wallet, X } from "lucide-react";
import { useAuthStore } from "@/stores/use-auth-store";
import { allowedLobeRedirect, lobeHubApi, type LobeHubConfig } from "@/lib/lobehub-api";
import "./ai-chat.css";
import TokenBillingPanel from "@/components/shared/token-billing-panel";

/** True while this document is rendered inside a frame. */
function framed() {
  try {
    return typeof window !== "undefined" && window.top !== window.self;
  } catch {
    // A foreign ancestor makes window.top opaque; that still means framed.
    return true;
  }
}

export default function AIChatPage() {
  const [config, setConfig] = useState<LobeHubConfig | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [frameUrl, setFrameUrl] = useState("");
  const user = useAuthStore((s) => s.user);
  const ensureSession = useAuthStore((s) => s.ensureSession);
  const fetchUser = useAuthStore((s) => s.fetchUser);
  const lock = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    // LobeHub sends a lost session to /signin, which the chat host redirects
    // back here. Inside the embed that would nest this page in itself, so climb
    // out to the real window instead of rendering a chat entry inside the chat.
    if (framed()) {
      try {
        window.top?.location.replace("/ai-chat");
      } catch { /* opaque ancestor: the link below is the way out */ }
      return;
    }
    let active = true;
    mounted.current = true;
    (async () => {
      if (!(await ensureSession())) {
        if (active) window.location.replace("/login?redirect=%2Fai-chat");
        return;
      }
      if (!active) return;
      const result = await lobeHubApi.config();
      if (!active) return;
      if (result.success && result.data) setConfig(result.data);
      else setError(result.message || "暂时无法读取聊天配置");
      await fetchUser(true);
      if (active && !useAuthStore.getState().user) setError("暂时无法读取账户信息，请刷新页面或重新登录");
    })().catch(() => { if (active) setError("暂时无法读取聊天配置，请刷新页面重试"); });
    return () => { active = false; mounted.current = false; };
  }, [ensureSession, fetchUser]);

  const enter = async () => {
    if (lock.current || !config?.enabled || !config.url || !user) return;
    const sessionToken = localStorage.getItem("access_token");
    lock.current = true; setBusy(true); setError("");
    try {
      const result = await lobeHubApi.launch(user.id);
      if (!mounted.current) return;
      if (useAuthStore.getState().user?.id !== user.id || localStorage.getItem("access_token") !== sessionToken) {
        setError("登录状态已变化，请重新连接 AI 聊天"); return;
      }
      if (!result.success || !result.data) { setError(result.message || "暂时无法连接 AI 聊天"); return; }
      if (!allowedLobeRedirect(result.data.url, config.url)) { setError("聊天地址配置异常，请联系管理员"); return; }
      setFrameUrl(result.data.url);
    } catch { if (mounted.current) setError("连接暂时失败，请稍后重试"); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  };

  // A ticket is single-use, so leaving the embed must also drop its URL: the
  // next entry asks for a fresh one instead of replaying a spent connection.
  const leave = useCallback(() => { setFrameUrl(""); void fetchUser(true); }, [fetchUser]);

  if (frameUrl) {
    return <div className="ai-chat-embed">
      <div className="ai-chat-embed-bar">
        <span className="ai-chat-embed-title"><MessageSquare size={16} aria-hidden /> AI 聊天</span>
        <span className="ai-chat-embed-balance"><Wallet size={15} aria-hidden />可用积分 <strong>{user?.points?.toLocaleString("zh-CN", {maximumFractionDigits: 6}) ?? "—"}</strong></span>
        <a href={frameUrl} target="_blank" rel="noreferrer noopener"><ExternalLink size={14} aria-hidden />在新标签页打开</a>
        <button type="button" onClick={leave}><X size={14} aria-hidden />退出聊天</button>
      </div>
      <iframe className="ai-chat-frame" src={frameUrl} title="AI 聊天" allow="clipboard-write; microphone" />
    </div>;
  }

  return <main className="ai-chat-entry">
    <header><MessageSquare aria-hidden /><h1>AI 聊天</h1><p>使用流光账号，连接你的 AI 对话空间。</p></header>
    <section className="ai-chat-entry-panel">
      <div className="ai-chat-balance"><Wallet size={18} aria-hidden /><span>可用积分</span><strong>{user?.points?.toLocaleString("zh-CN", {maximumFractionDigits: 6}) ?? "—"}</strong></div>
      <p>进入后在本页内打开，自动登录并同步你的模型服务。聊天记录保存在你的独立账号中，模型调用使用主站积分。</p>
      <p className="ai-chat-note">计费方式由每个模型各自的后台配置决定：配置了 Token 单价的模型按每百万输入、输出 Token 结算，调用前预留额度、结束后按真实用量扣费并释放余量；其余模型仍按单次价格计费。模型列表会标出各自的价格，工具循环和辅助调用也归属你的 API Key。</p>
      {error && <p role="alert" className="ai-chat-error">{error}</p>}
      {config && !config.enabled && <p role="status">AI 聊天尚未开放，请管理员完成接入配置。</p>}
      <div className="ai-chat-entry-actions">
        <button type="button" disabled={busy || !config?.enabled || !user} onClick={enter}>{busy ? <Loader2 size={17} className="animate-spin" /> : <ArrowUpRight size={17} />} {busy ? "正在连接…" : "进入 AI 聊天"}</button>
        {error && !user && <Link href="/login?redirect=%2Fai-chat">重新登录</Link>}
        <Link href="/account">账户与 API Key</Link><Link href="/billing">充值积分</Link>
      </div>
    </section>
    {config?.enabled && <TokenBillingPanel />}
  </main>;
}
