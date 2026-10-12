"use client";
import Link from "next/link";
import { ArrowRight, AlertCircle, Loader2, X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { useAuth } from "./auth-provider";

export function Loading({ label = "Loading…" }: { label?: string }) { return <div className="loading" role="status"><Loader2 size={18} className="spin" /><span>{label}</span></div>; }
export function Alert({ children, success = false }: { children: React.ReactNode; success?: boolean }) { return <div className={`alert ${success ? "success" : ""}`} role={success ? "status" : "alert"}><AlertCircle size={17} /><span>{children}</span></div>; }
export function PageHeading({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) { return <header className="page-heading"><div><h1>{title}</h1>{description && <p>{description}</p>}</div>{action}</header>; }
export function EmptyState({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) { return <div className="empty-state"><div className="empty-symbol" aria-hidden><span /><span /><span /></div><h2>{title}</h2><p>{description}</p>{action}</div>; }
export function RequireAccount({ children, title = "Your workspace, ready when you are." }: { children: React.ReactNode; title?: string }) {
  const { user, loading } = useAuth();
  if (loading) return <Loading label="Checking your session…" />;
  if (!user) return <EmptyState title={title} description="Sign in to access your creations, credits and account settings." action={<Link className="button primary" href="/login">Sign in <ArrowRight size={16} /></Link>} />;
  return <>{children}</>;
}
export function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    const previousFocus = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      // React may already have detached the dialog when native close runs.
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected && !previousFocus.closest("[inert]")) previousFocus.focus({ preventScroll: true });
    };
  }, []);
  return <dialog ref={ref} className="modal" aria-labelledby={titleId} onCancel={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}><div className="modal-inner"><header><h2 id={titleId}>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={20} /></button></header>{children}</div></dialog>;
}
export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  return <button ref={ref} className="button small" onClick={async () => {
    try { await navigator.clipboard.writeText(value); if (ref.current) ref.current.textContent = "Copied"; setTimeout(() => { if (ref.current) ref.current.textContent = label; }, 1800); }
    catch { if (ref.current) ref.current.textContent = "Select and copy"; }
  }}>{label}</button>;
}
