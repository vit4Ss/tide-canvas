"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Copy, KeyRound, Loader2, Terminal, ArrowUpRight } from "lucide-react";
import { userApiKeyApi, type UserApiKey } from "@/lib/user-api-key";
import { toast } from "@/components/shared/toast";
import "./api-key-panel.css";
import { ApiKeySetup } from "./api-key-setup";

// The account page is the one place a user reads their own key, so it is shown
// in full as soon as it loads. Every network reply is checked against the
// session and mount that requested it, so a late reveal from a previous login
// can never be displayed or copied under another account.
export function ApiKeyPanel({ accountId }: { accountId: string }) {
  const [keyInfo, setKeyInfo] = useState<UserApiKey | null>(null);
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [setupMode, setSetupMode] = useState<"manual" | "ccswitch" | null>(null);
  const locked = useRef(false);
  const alive = useRef(false);
  const sessionVersion = useRef(0);
  const loadVersion = useRef(0);
  const invalidateRequests = () => { loadVersion.current++; return ++sessionVersion.current; };

  const load = async (version: number, resetBusy = false) => {
    const request = ++loadVersion.current;
    const current = () => alive.current && version === sessionVersion.current && request === loadVersion.current;
    setSecret("");
    setKeyInfo(null);
    setError("");
    setSetupMode(null);
    try {
      const meta = await userApiKeyApi.get(accountId);
      if (!current()) return;
      if (!meta.success || !meta.data) { setKeyInfo(null); setError(meta.message || "密钥加载失败，请重试"); return; }
      setKeyInfo(meta.data);
      const revealed = await userApiKeyApi.reveal(accountId, meta.data.revision);
      if (!current()) return;
      if (revealed.success && revealed.data?.revision === meta.data.revision && typeof revealed.data.key === "string" && /^tc_sk_[A-Za-z0-9_-]+$/.test(revealed.data.key)) setSecret(revealed.data.key);
      else if (revealed.success) setError("密钥状态已更新或返回值无效，请重试");
      else setError(revealed.message || "读取密钥失败，请重试");
    } catch {
      if (current()) setError("密钥加载失败，请重试");
    } finally {
      if (resetBusy && current()) setBusy(false);
    }
  };

  useEffect(() => {
    alive.current = true;
    locked.current = false;
    void load(sessionVersion.current, true);
    const sessionChanged = (event: StorageEvent) => {
      if (event.key === null || event.key === "access_token" || event.key === "refresh_token") {
        invalidateRequests();
        locked.current = false;
        setBusy(false);
        setSecret("");
        setKeyInfo(null);
        setSetupMode(null);
        setError("登录状态已变化，请刷新页面");
      }
    };
    window.addEventListener("storage", sessionChanged);
    const restored = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      locked.current = false;
      setBusy(false);
      void load(invalidateRequests());
    };
    window.addEventListener("pageshow", restored);
    return () => {
      alive.current = false;
      invalidateRequests();
      window.removeEventListener("storage", sessionChanged);
      window.removeEventListener("pageshow", restored);
    };
    // load reads accountId from the closure; the effect re-runs when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  const act = async (action: "copy" | "reload" | "enable") => {
    if (locked.current) return;
    locked.current = true;
    const version = sessionVersion.current;
    setBusy(true);
    try {
      if (action === "reload") { await load(version); return; }
      if (action === "enable") {
        // Users can no longer disable a key here, but one disabled before that
        // control was removed must still have a way back, and administrators
        // have no endpoint for it.
        if (!keyInfo) return;
        const res = await userApiKeyApi.setEnabled(accountId, keyInfo.revision, true);
        if (!alive.current || version !== sessionVersion.current) return;
        if (!res.success || !res.data) { toast.error(res.message || "操作失败"); await load(version); return; }
        setKeyInfo(res.data);
        toast.success("密钥已启用");
        return;
      }
      let key = secret;
      if (!key && keyInfo) {
        const res = await userApiKeyApi.reveal(accountId, keyInfo.revision);
        if (!alive.current || version !== sessionVersion.current) return;
        if (!res.success || !res.data || res.data.revision !== keyInfo.revision) { toast.error(res.message || "密钥状态已变化，请重新读取"); return; }
        key = res.data.key;
        setSecret(key);
      }
      if (!key) return;
      await navigator.clipboard.writeText(key);
      if (alive.current && version === sessionVersion.current) toast.success("API Key 已复制");
    } catch {
      if (alive.current && version === sessionVersion.current) toast.error(action === "copy" ? "复制失败，请手动选中密钥复制" : "操作失败，请稍后重试");
    } finally {
      if (version === sessionVersion.current) locked.current = false;
      if (alive.current && version === sessionVersion.current) setBusy(false);
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
            <input aria-label="API Key" readOnly value={secret || keyInfo.hint} autoComplete="off" spellCheck={false} onFocus={(event) => secret && event.currentTarget.select()} />
            <button type="button" disabled={busy || !secret} aria-label="复制 API Key" onClick={() => act("copy")}><Copy size={16} /><span>复制</span></button>
          </div>
          <div className="acc-key-actions">
            <button type="button" className="pf-btn sec" disabled={busy || !secret || !keyInfo.enabled || !!error} onClick={() => setSetupMode("manual")}><Terminal size={15} />使用密钥</button>
            <button type="button" className="pf-btn sec" disabled={busy || !secret || !keyInfo.enabled || !!error} onClick={() => setSetupMode("ccswitch")}><ArrowUpRight size={15} />导入到 CC Switch</button>
          </div>
          <div className="acc-key-footer">
            {error
              ? <span role="status">{error} <button type="button" className="acc-key-retry" disabled={busy} onClick={() => act("reload")}>重试</button></span>
              : !keyInfo.enabled
                ? <span role="status">密钥已停用，接入的应用暂时无法调用 <button type="button" className="acc-key-retry" disabled={busy} onClick={() => act("enable")}>启用</button></span>
                : <span>{secret ? "只有你能看到这把密钥，请勿分享给他人" : "正在读取密钥…"}</span>}
            <div>
              <Link className="pf-btn sec" href="/api-docs#chat">接入智能体</Link>
              <Link className="pf-btn sec" href="/api-usage">Token 用量与记录</Link>
              <Link className="pf-btn sec" href="/api-docs">API 文档</Link>
            </div>
          </div>
        </>
      )}
      {setupMode && secret && keyInfo?.enabled && <ApiKeySetup accountId={accountId} secret={secret} mode={setupMode} onModeChange={setSetupMode} onClose={() => setSetupMode(null)} />}
    </section>
  );
}
