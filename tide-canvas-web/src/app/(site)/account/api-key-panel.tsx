"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Copy, KeyRound, Loader2 } from "lucide-react";
import { userApiKeyApi, type UserApiKey } from "@/lib/user-api-key";
import { toast } from "@/components/shared/toast";
import "./api-key-panel.css";

// The account page is the one place a user reads their own key, so it is shown
// in full as soon as it loads. Every network reply is checked against the
// session and mount that requested it, so a late reveal from a previous login
// can never be displayed or copied under another account.
export function ApiKeyPanel({ accountId }: { accountId: string }) {
  const [keyInfo, setKeyInfo] = useState<UserApiKey | null>(null);
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const alive = useRef(false);
  const sessionVersion = useRef(0);

  const load = async (version: number) => {
    const meta = await userApiKeyApi.get(accountId);
    if (!alive.current || version !== sessionVersion.current) return;
    if (!meta.success || !meta.data) { setKeyInfo(null); setError(meta.message || "密钥加载失败，请重试"); return; }
    setKeyInfo(meta.data);
    setError("");
    const revealed = await userApiKeyApi.reveal(accountId, meta.data.revision);
    if (!alive.current || version !== sessionVersion.current) return;
    if (revealed.success && revealed.data) setSecret(revealed.data.key);
    else { setSecret(""); setError(revealed.message || "读取密钥失败，请重试"); }
  };

  useEffect(() => {
    alive.current = true;
    void load(sessionVersion.current);
    const sessionChanged = (event: StorageEvent) => {
      if (event.key === null || event.key === "access_token" || event.key === "refresh_token") {
        sessionVersion.current++;
        setSecret("");
        setKeyInfo(null);
        setError("登录状态已变化，请刷新页面");
      }
    };
    window.addEventListener("storage", sessionChanged);
    return () => {
      alive.current = false;
      window.removeEventListener("storage", sessionChanged);
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
        if (!res.success || !res.data) { toast.error(res.message || "读取密钥失败"); return; }
        key = res.data.key;
        setSecret(key);
      }
      if (!key) return;
      await navigator.clipboard.writeText(key);
      if (alive.current && version === sessionVersion.current) toast.success("API Key 已复制");
    } catch {
      if (alive.current) toast.error(action === "copy" ? "复制失败，请手动选中密钥复制" : "操作失败，请稍后重试");
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
            <input aria-label="API Key" readOnly value={secret || keyInfo.hint} autoComplete="off" spellCheck={false} onFocus={(event) => secret && event.currentTarget.select()} />
            <button type="button" disabled={busy || !secret} aria-label="复制 API Key" onClick={() => act("copy")}><Copy size={16} /><span>复制</span></button>
          </div>
          <div className="acc-key-footer">
            {error
              ? <span role="status">{error} <button type="button" className="acc-key-retry" disabled={busy} onClick={() => act("reload")}>重试</button></span>
              : !keyInfo.enabled
                ? <span role="status">密钥已停用，接入的应用暂时无法调用 <button type="button" className="acc-key-retry" disabled={busy} onClick={() => act("enable")}>启用</button></span>
                : <span>{secret ? "只有你能看到这把密钥，请勿分享给他人" : "正在读取密钥…"}</span>}
            <div>
              <Link className="pf-btn sec" href="/api-docs#chat">接入智能体</Link>
              <Link className="pf-btn sec" href="/api-usage">API 调用记录</Link>
              <Link className="pf-btn sec" href="/api-docs">API 文档</Link>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
