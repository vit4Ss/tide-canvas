"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { authApi } from "@/lib/api";
import { loadGoogleIdentity } from "@/lib/google-identity";
import { getAccessToken } from "@/lib/http";
import type { LoginVO } from "@/types/user";
import { Alert } from "./ui";
import { useAuth } from "./auth-provider";

const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";
export function GoogleSignIn({ disabled, onBusy, onSuccess }: { disabled: boolean; onBusy: (busy: boolean) => void; onSuccess: (result: LoginVO) => void }) {
  const { sessionVersion } = useAuth();
  const host = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onBusy, onSuccess, disabled });
  const inFlight = useRef(false);
  const active = useRef(false);
  const version = useRef(0);
  const exchangeController = useRef<AbortController | null>(null);
  const codeController = useRef<AbortController | null>(null);
  const deadline = useRef(0);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [error, setError] = useState("");
  const [pending, setPending] = useState<{ credential: string; nonce: string; email: string; existingAccount: boolean } | null>(null);
  const [code, setCode] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");
  useEffect(() => { callbacks.current = { onBusy, onSuccess, disabled }; }, [onBusy, onSuccess, disabled]);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => { if (!cooldown) return; const timer = setTimeout(() => setCooldown(cooldown-1), 1000); return () => clearTimeout(timer); }, [cooldown]);

  useEffect(() => {
    if (!clientId) return;
    const controller = new AbortController();
    const currentVersion = ++version.current;
    let mounted = true; let observer: ResizeObserver | undefined; let expiry: ReturnType<typeof setTimeout> | undefined;
    const exchange = async (credential: string, nonce: string) => {
      if (!mounted || callbacks.current.disabled || inFlight.current) return;
      if (Date.now() >= deadline.current) { setStatus("failed"); setError("Google sign-in expired. Please try again."); return; }
      const access = getAccessToken(); const session = sessionVersion(); const request = new AbortController(); exchangeController.current = request;
      inFlight.current = true; callbacks.current.onBusy(true); setError("");
      try {
        const result = await authApi.google(credential, nonce, undefined, request.signal);
        if (!mounted) return;
        if (session !== sessionVersion() || access !== getAccessToken()) throw new Error("Your session changed while signing in. Please try again.");
        if (result.success) {
          if (!result.data || typeof result.data !== "object" || !("accessToken" in result.data)) throw new Error("The Google sign-in response was incomplete. Please try again.");
          callbacks.current.onSuccess(result.data);
        }
        else if (result.code === 409 && result.data && "requiresLink" in result.data) {
          setPending({ credential, nonce, email: result.data.email, existingAccount: result.data.existingAccount !== false }); setError("");
        } else { setError(result.message); setStatus("failed"); }
      } catch (cause) { if (mounted) { setError(cause instanceof Error ? cause.message : "Unable to sign in with Google. Please try again."); setStatus("failed"); } }
      finally { inFlight.current = false; if (mounted) callbacks.current.onBusy(false); }
    };
    const initialize = async () => {
      setStatus("loading"); setError(""); setPending(null); setCode(""); setNotice(""); setSending(false);
      try {
        const started = Date.now();
        const challenge = await authApi.googleChallenge(controller.signal);
        if (!mounted) return;
        if (!challenge.success) throw new Error(challenge.code === 404 ? "Google sign-in is not available on this server yet. Use your password or try again later." : challenge.message);
        if (!challenge.data || typeof challenge.data.nonce !== "string" || challenge.data.nonce.length !== 43 || !Number.isFinite(challenge.data.expiresIn) || challenge.data.expiresIn <= 0) throw new Error("Unable to prepare Google sign-in. Please try again later.");
        if (challenge.data.clientId !== clientId) throw new Error("Google sign-in is not configured for this website. Please use your password.");
        deadline.current = started + challenge.data.expiresIn*1000;
        const google = await loadGoogleIdentity();
        if (!mounted || !host.current) return;
        if (Date.now() >= deadline.current) throw new Error("Google sign-in expired. Please try again.");
        google.initialize({ client_id: clientId, nonce: challenge.data.nonce, callback: ({ credential }) => { void exchange(credential, challenge.data.nonce); }, ux_mode: "popup", auto_select: false });
        const element = host.current;
        let renderedWidth = 0;
        const render = () => {
          if (!mounted) return;
          const width = Math.max(200, Math.min(400, Math.floor(element.getBoundingClientRect().width)));
          if (width === renderedWidth) return;
          renderedWidth = width;
          element.replaceChildren();
          google.renderButton(element, { theme: "outline", size: "large", text: "continue_with", shape: "rectangular", width, locale: "en" });
        };
        render(); observer = new ResizeObserver(render); observer.observe(element);
        setStatus("ready");
        expiry = setTimeout(() => { if (mounted) { exchangeController.current?.abort(); codeController.current?.abort(); setStatus("failed"); setPending(null); setError("Google sign-in expired. Please try again."); } }, Math.max(0, deadline.current-Date.now()));
      } catch (cause) { if (mounted) { setStatus("failed"); setError(cause instanceof Error ? cause.message : "Unable to prepare Google sign-in."); } }
    };
    void initialize();
    return () => { mounted = false; version.current += 1; controller.abort(); exchangeController.current?.abort(); codeController.current?.abort(); inFlight.current = false; observer?.disconnect(); if (expiry) clearTimeout(expiry); if (active.current && currentVersion < version.current) callbacks.current.onBusy(false); };
  }, [attempt, sessionVersion]);

  const sendCode = async () => {
    if (!pending || sending || cooldown > 0) return;
    const currentVersion = version.current; const request = new AbortController(); codeController.current = request;
    setSending(true); setError("");
    try {
      const result = await authApi.googleEmailCode(pending.email, request.signal);
      if (!active.current || currentVersion !== version.current) return;
      if (result.success) { setCooldown(60); setNotice("Check your inbox for a verification code."); } else setError(result.message);
    } finally { if (active.current && currentVersion === version.current) setSending(false); }
  };
  const link = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!pending || inFlight.current || disabled) return;
    const currentVersion = version.current; const access = getAccessToken(); const session = sessionVersion(); const request = new AbortController(); exchangeController.current = request;
    inFlight.current = true; onBusy(true); setError("");
    try {
      const result = await authApi.google(pending.credential, pending.nonce, code, request.signal);
      if (!active.current || currentVersion !== version.current) return;
      if (session !== sessionVersion() || access !== getAccessToken()) throw new Error("Your session changed while signing in. Please try again.");
      if (result.success) {
        if (!result.data || typeof result.data !== "object" || !("accessToken" in result.data)) throw new Error("The Google sign-in response was incomplete. Please try again.");
        onSuccess(result.data);
      }
      else { setError(result.message); if (result.code !== 400 || !result.message.includes("verification code")) { setPending(null); setStatus("failed"); } }
    } catch (cause) { if (active.current && currentVersion === version.current) { setError(cause instanceof Error ? cause.message : "Unable to continue. Please start Google sign-in again."); setPending(null); setStatus("failed"); } }
    finally { if (currentVersion === version.current) { inFlight.current = false; if (active.current) onBusy(false); } }
  };
  if (!clientId) return null;
  return <section className="auth-google" aria-label="Google sign-in">
    {!pending && <div ref={host} className="auth-google-button" inert={disabled || status !== "ready"} hidden={status === "failed"} />}
    {status === "loading" && <p role="status">Preparing Google sign-in…</p>}
    {disabled && <p role="status">Signing in…</p>}
    {pending && <form className="auth-google-link" onSubmit={(event) => void link(event)}>
      <p><strong>{pending.existingAccount ? "Link your existing account" : "Verify your email"}</strong><br />Verify <span className="auth-google-email">{pending.email}</span>{pending.existingAccount ? " to keep your credits and creations." : " to create your account."}</p>
      <label htmlFor="google-link-code">Email verification code</label>
      <div className="code-input"><input id="google-link-code" inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value)} disabled={disabled} placeholder="6-digit code" /><button type="button" className="button small" onClick={() => void sendCode()} disabled={disabled || sending || cooldown > 0}>{sending ? "Sending…" : cooldown ? `Resend in ${cooldown}s` : "Send code"}</button></div>
      <button type="submit" className="button primary" disabled={disabled || !/^[0-9]{6}$/.test(code)}>Verify and continue</button>
      <button type="button" className="text-link" disabled={disabled} onClick={() => setAttempt((value) => value+1)}>Use a different Google account</button>
    </form>}
    {error && <Alert>{error}</Alert>}
    {notice && pending && <p role="status">{notice}</p>}
    {status === "failed" && <button type="button" className="button small" disabled={disabled} onClick={() => setAttempt((value) => value+1)}>Try Google again</button>}
    <p className="auth-google-terms">By continuing with Google, you agree to our <Link href="/terms">Terms</Link> and <Link href="/privacy">Privacy Policy</Link>.</p>
    <div className="auth-divider"><span>or continue with your account</span></div>
  </section>;
}
