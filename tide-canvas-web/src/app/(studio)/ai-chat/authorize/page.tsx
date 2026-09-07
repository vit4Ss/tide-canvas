"use client";

import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuthStore } from "@/stores/use-auth-store";
import { allowedLobeRedirect, lobeHubApi } from "@/lib/lobehub-api";
import "../ai-chat.css";

function Authorize() {
  const request = useSearchParams().get("request") || "";
  const [error, setError] = useState("");
  const ensureSession = useAuthStore((s) => s.ensureSession);
  const work = useRef<{ request: string; promise: Promise<string | null> } | null>(null);
  useEffect(() => {
    let active = true;
    if (work.current?.request !== request) {
      work.current = { request, promise: (async () => {
        if (!/^[A-Za-z0-9_-]{43}$/.test(request)) throw new Error("登录请求无效，请重新进入 AI 聊天");
        if (!(await ensureSession())) return null;
        const config = await lobeHubApi.config();
        if (!config.success || !config.data?.enabled || !config.data.url) throw new Error("统一登录尚未开放");
        const result = await lobeHubApi.approve(request);
        if (!result.success || !result.data) throw new Error(result.message || "登录请求已过期，请重新连接");
        if (!allowedLobeRedirect(result.data.url, config.data.url)) throw new Error("登录返回地址异常");
        return result.data.url;
      })() };
    }
    work.current.promise.then((url) => {
      if (!active) return;
      if (url) { window.location.replace(url); return; }
      // A stale main session invalidates this launch flow. Sign in in the real
      // window and return to /ai-chat for a fresh one-use ticket, rather than
      // exposing the authorization hand-off as a top-level intermediary page.
      const login = "/login?redirect=%2Fai-chat";
      let target: Location = window.location;
      try {
        if (window.top && window.top !== window.self && window.top.location) target = window.top.location;
      } catch { /* opaque ancestor: fall back to this frame */ }
      target.replace(login);
    })
      .catch((error: Error) => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [request, ensureSession]);
  return <main className="ai-chat-entry"><section className="ai-chat-entry-panel">
    <h1>{error ? "暂时无法连接" : "正在登录 AI 聊天"}</h1>
    {error ? <p role="alert" className="ai-chat-error">{error}</p> : <p><Loader2 size={18} className="animate-spin" /> 正在验证流光账号，请稍候…</p>}
    <Link href="/ai-chat">返回 AI 聊天入口</Link>
  </section></main>;
}
export default function AuthorizePage() { return <Suspense fallback={<p>正在准备登录…</p>}><Authorize /></Suspense>; }
