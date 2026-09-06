"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Loader2, MessageSquare, Wallet } from "lucide-react";
import { useAuthStore } from "@/stores/use-auth-store";
import { allowedLobeRedirect, lobeHubApi, type LobeHubConfig } from "@/lib/lobehub-api";
import "./ai-chat.css";
import TokenBillingPanel from "@/components/shared/token-billing-panel";

export default function AIChatPage() {
  const [config, setConfig] = useState<LobeHubConfig | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const user = useAuthStore((s) => s.user);
  const ensureSession = useAuthStore((s) => s.ensureSession);
  const fetchUser = useAuthStore((s) => s.fetchUser);
  const lock = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
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
      window.location.assign(result.data.url);
    } catch { if (mounted.current) setError("连接暂时失败，请稍后重试"); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  };

  return <main className="ai-chat-entry">
    <header><MessageSquare aria-hidden /><h1>AI 聊天</h1><p>使用流光账号，连接你的 AI 对话空间。</p></header>
    <section className="ai-chat-entry-panel">
      <div className="ai-chat-balance"><Wallet size={18} aria-hidden /><span>可用积分</span><strong>{user?.points?.toLocaleString("zh-CN", {maximumFractionDigits: 6}) ?? "—"}</strong></div>
      <p>进入后自动登录并同步你的模型服务。聊天记录保存在你的独立账号中，模型调用使用主站积分。</p>
      <p className="ai-chat-note">{config?.tokenBilling ? "按模型的每百万输入、输出 Token 单价计费。调用前预留额度，结束后按真实用量结算并释放余量；工具循环和辅助调用也归属你的 API Key。" : "按所选模型的单次价格计费；未产生有效内容的失败调用退回积分。"}</p>
      {error && <p role="alert" className="ai-chat-error">{error}</p>}
      {config && !config.enabled && <p role="status">AI 聊天尚未开放，请管理员完成接入配置。</p>}
      <div className="ai-chat-entry-actions">
        <button type="button" disabled={busy || !config?.enabled || !user} onClick={enter}>{busy ? <Loader2 size={17} className="animate-spin" /> : <ArrowUpRight size={17} />} {busy ? "正在连接…" : "进入 AI 聊天"}</button>
        {error && !user && <Link href="/login?redirect=%2Fai-chat">重新登录</Link>}
        <Link href="/account">账户与 API Key</Link><Link href="/billing">充值积分</Link>
      </div>
    </section>
    {config?.enabled && config.tokenBilling && <TokenBillingPanel />}
  </main>;
}
