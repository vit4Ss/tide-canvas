"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, MessageSquare, RefreshCw } from "lucide-react";
import { useAuthStore } from "@/stores/use-auth-store";
import { allowedLobeRedirect, lobeHubApi, type LobeHubConfig } from "@/lib/lobehub-api";
import "./ai-chat.css";

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
  const [frameReady, setFrameReady] = useState(false);
  const user = useAuthStore((s) => s.user);
  const ensureSession = useAuthStore((s) => s.ensureSession);
  const fetchUser = useAuthStore((s) => s.fetchUser);
  const lock = useRef(false);
  const mounted = useRef(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const awaitingChatDocument = useRef(false);
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

  // Every connection re-runs the binding, which is what pushes the current
  // model list and prices into the chat. Model names live in the chat's own
  // storage, so a price edited in the admin reaches the picker on the next
  // connection rather than on its own.
  const connect = useCallback(async () => {
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
      awaitingChatDocument.current = false;
      setFrameReady(false);
      setFrameUrl(result.data.url);
    } catch { if (mounted.current) setError("连接暂时失败，请稍后重试"); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }, [config, user]);

  // The cross-origin bridge reports when account binding has completed. Keep
  // every connect/OIDC hand-off covered, then reveal only the following LobeHub
  // document. Origin + Window checks prevent another frame from spoofing it.
  useEffect(() => {
    if (!config?.url) return;
    let expectedOrigin = "";
    try { expectedOrigin = new URL(config.url).origin; } catch { return; }
    const receive = (event: MessageEvent) => {
      if (event.origin !== expectedOrigin || event.source !== frameRef.current?.contentWindow) return;
      const message = event.data as { source?: unknown; type?: unknown; message?: unknown } | null;
      if (!message || message.source !== "flowinglight-ai-chat") return;
      if (message.type === "bound") {
        awaitingChatDocument.current = true;
      } else if (message.type === "error") {
        awaitingChatDocument.current = false;
        setFrameReady(false);
        setFrameUrl("");
        setError(typeof message.message === "string" && message.message.trim()
          ? message.message.trim().slice(0, 240)
          : "AI 聊天连接失败，请重新尝试");
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [config?.url]);

  // Never reveal an authorization/bridge document as if it were the chat. A
  // stalled or mixed-version deployment becomes a recoverable connection error.
  useEffect(() => {
    if (!frameUrl || frameReady) return;
    let timer = 0;
    let finalWaits = 0;
    const expire = () => {
      if (awaitingChatDocument.current && finalWaits < 2) {
        finalWaits += 1;
        timer = window.setTimeout(expire, 10_000);
        return;
      }
      setFrameUrl("");
      setError("AI 聊天连接超时，请重新尝试");
    };
    timer = window.setTimeout(expire, 20_000);
    return () => window.clearTimeout(timer);
  }, [frameUrl, frameReady]);

  // Entering is what this page is for, so it happens on arrival. Exactly one
  // automatic attempt per visit; a failed connection becomes an explicit retry
  // instead of looping behind the loading shell.
  const autoEntered = useRef(false);
  useEffect(() => {
    if (autoEntered.current || !config?.enabled || !user) return;
    autoEntered.current = true;
    const frame = requestAnimationFrame(() => void connect());
    return () => cancelAnimationFrame(frame);
  }, [config, user, connect]);

  if (frameUrl) {
    return <div className="ai-chat-embed">
      <div className="ai-chat-embed-bar">
        <span className="ai-chat-embed-title"><MessageSquare size={16} aria-hidden /> AI 聊天</span>
        <button type="button" className="ai-chat-reconnect" onClick={connect} disabled={busy} title="重新连接并同步模型与价格" aria-label="重新连接 AI 聊天">
          {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <RefreshCw size={14} aria-hidden />}
        </button>
      </div>
      <div className="ai-chat-stage" data-ready={frameReady ? "true" : "false"}>
        <iframe
          ref={frameRef}
          className="ai-chat-frame"
          src={frameUrl}
          title="AI 聊天"
          allow="clipboard-write; microphone"
          tabIndex={frameReady ? 0 : -1}
          aria-hidden={!frameReady}
          onLoad={() => {
            if (!awaitingChatDocument.current) return;
            awaitingChatDocument.current = false;
            setFrameReady(true);
          }}
        />
        {!frameReady && <div className="ai-chat-boot" aria-live="polite" aria-busy="true"><Loader2 aria-hidden /><span className="sr-only">正在进入 AI 聊天</span></div>}
      </div>
    </div>;
  }

  const unavailable = error || (config && !config.enabled ? "AI 聊天尚未开放，请联系管理员完成接入配置。" : "");
  if (!unavailable) {
    return <main className="ai-chat-boot" aria-live="polite" aria-busy="true"><Loader2 aria-hidden /><span className="sr-only">正在进入 AI 聊天</span></main>;
  }
  return <main className="ai-chat-entry ai-chat-failure">
    <section className="ai-chat-entry-panel" role="alert">
      <MessageSquare aria-hidden />
      <h1>暂时无法进入 AI 聊天</h1>
      <p className="ai-chat-error">{unavailable}</p>
      <div className="ai-chat-entry-actions">
        <button type="button" disabled={busy} onClick={() => {
          if (config?.enabled && user) void connect();
          else window.location.replace("/ai-chat");
        }}>{busy ? <Loader2 size={17} className="animate-spin" aria-hidden /> : <RefreshCw size={17} aria-hidden />}重新尝试</button>
        {!user && <Link href="/login?redirect=%2Fai-chat">重新登录</Link>}
      </div>
    </section>
  </main>;
}
