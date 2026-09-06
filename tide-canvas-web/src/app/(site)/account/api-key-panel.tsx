"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Copy, Eye, EyeOff, KeyRound, Loader2, RefreshCw } from "lucide-react";
import { userApiKeyApi, type UserApiKey } from "@/lib/user-api-key";
import { toast } from "@/components/shared/toast";
import { confirmDialog } from "@/components/shared/confirm";
import "./api-key-panel.css";

export function ApiKeyPanel({ accountId }: { accountId: string }) {
  const [keyInfo, setKeyInfo] = useState<UserApiKey | null>(null);
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const alive = useRef(false);
  const secretRequest = useRef(0);
  const sessionVersion = useRef(0);

  useEffect(() => {
    let cancelled = false;
    alive.current = true;
    const requestVersion = sessionVersion.current;
    userApiKeyApi.get(accountId).then((res) => {
      if (cancelled) return;
      if (requestVersion !== sessionVersion.current) return;
      if (res.success && res.data) setKeyInfo(res.data);
      else setError(res.message || "密钥加载失败，请重试");
    });
    const invalidateReveal = () => { secretRequest.current++; };
    const hide = () => { if (document.hidden) { invalidateReveal(); setSecret(""); } };
    const sessionChanged = (event: StorageEvent) => {
      if (event.key === null || event.key === "access_token" || event.key === "refresh_token") {
        sessionVersion.current++;
        invalidateReveal();
        setSecret("");
        setKeyInfo(null);
        setError("登录状态已变化，请刷新页面");
      }
    };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("storage", sessionChanged);
    return () => {
      cancelled = true; alive.current = false; invalidateReveal();
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("storage", sessionChanged);
    };
  }, [accountId]);

  useEffect(() => {
    if (!secret) return;
    const timer = window.setTimeout(() => setSecret(""), 60_000);
    return () => window.clearTimeout(timer);
  }, [secret]);

  const reload = async () => {
    const version = sessionVersion.current;
    const res = await userApiKeyApi.get(accountId);
    if (!alive.current || version !== sessionVersion.current) return;
    setSecret("");
    setKeyInfo(res.success && res.data ? res.data : null);
    setError(res.success ? "" : res.message || "密钥加载失败，请重试");
  };

  const act = async (action: "show" | "copy" | "rotate" | "toggle" | "reload") => {
    if (locked.current || (!keyInfo && action !== "reload")) return;
    locked.current = true;
    const version = sessionVersion.current;
    setBusy(true);
    try {
      if (action === "reload") { await reload(); return; }
      if (!keyInfo) return;
      if (action === "rotate") {
        const confirmed = await confirmDialog({
          title: "重置默认 API Key",
          message: "重置后旧 Key 将立即失效，已接入的应用需要更新密钥。",
          confirmText: "确认重置",
          danger: true,
        });
        if (!confirmed || !alive.current || version !== sessionVersion.current) return;
      }
      if (action === "show" || action === "copy") {
        const requestVersion = secretRequest.current;
        const res = await userApiKeyApi.reveal(accountId, keyInfo.revision);
        if (!alive.current || requestVersion !== secretRequest.current) return;
        if (!res.success || !res.data) { setSecret(""); toast.error(res.message || "读取密钥失败"); await reload(); return; }
        if (action === "show") {
          // A reveal request can finish after the tab has been hidden.
          if (!document.hidden) setSecret(res.data.key);
        }
        else {
          await navigator.clipboard.writeText(res.data.key);
          if (alive.current) toast.success("API Key 已复制");
        }
        return;
      }
      setSecret("");
      const res = action === "rotate"
        ? await userApiKeyApi.rotate(accountId, keyInfo.revision)
        : await userApiKeyApi.setEnabled(accountId, keyInfo.revision, !keyInfo.enabled);
      if (!alive.current || version !== sessionVersion.current) return;
      if (!res.success || !res.data) { toast.error(res.message || "操作失败"); await reload(); return; }
      setKeyInfo(res.data);
      toast.success(action === "rotate" ? "密钥已重置，旧 Key 已失效" : res.data.enabled ? "密钥已启用" : "密钥已停用");
    } catch {
      if (alive.current) toast.error(action === "copy" ? "复制失败，请显示密钥后手动复制" : "操作失败，请稍后重试");
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  };

  return (
    <section className="panel acc-api-key" aria-labelledby="account-api-key-title">
      <div className="acc-key-heading">
        <div><KeyRound size={18} aria-hidden /><h2 id="account-api-key-title">默认 API Key</h2></div>
        {keyInfo && <span className={`acc-key-status${keyInfo.enabled ? " enabled" : ""}`}>{keyInfo.enabled ? "已启用" : "已停用"}</span>}
      </div>
      <p className="ph-note">每个账号独立生成一把密钥，用于应用接入时识别你的账号。</p>
      {!keyInfo ? (
        <div className="acc-key-loading" role="status">
          {error ? <>{error}<button type="button" className="pf-btn sec" disabled={busy} onClick={() => act("reload")}>重试</button></>
            : <><Loader2 size={15} className="animate-spin" aria-hidden />正在载入密钥…</>}
        </div>
      ) : (
        <>
          <div className="acc-key-value">
            <input aria-label={secret ? "完整 API Key" : "已隐藏的 API Key"} readOnly value={secret || keyInfo.hint} autoComplete="off" spellCheck={false} onFocus={(event) => secret && event.currentTarget.select()} />
            <button type="button" disabled={busy} aria-label={secret ? "隐藏 API Key" : "显示 API Key"} onClick={() => secret ? setSecret("") : act("show")}>{secret ? <EyeOff size={17} /> : <Eye size={17} />}</button>
            <button type="button" disabled={busy} aria-label="复制 API Key" onClick={() => act("copy")}><Copy size={16} /><span>复制</span></button>
          </div>
          <div className="acc-key-footer">
            <span>{secret ? "完整密钥将在 60 秒后自动隐藏" : "密钥已隐藏，只有你可以查看完整内容"}</span>
            <div>
              <Link className="pf-btn sec" href="/ai-chat">AI 聊天</Link>
              <button type="button" className="pf-btn sec" disabled={busy} onClick={() => act("toggle")}>{keyInfo.enabled ? "停用" : "启用"}</button>
              <button type="button" className="pf-btn sec" disabled={busy} onClick={() => act("rotate")}><RefreshCw size={13} aria-hidden />重置密钥</button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
