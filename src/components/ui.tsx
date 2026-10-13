"use client";
import Link from "next/link";
import { ArrowRight, AlertCircle, Loader2, X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { useAuth } from "./auth-provider";
import { lockModalScroll } from "@/lib/modal-scroll";

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
export function Modal({ title, children, onClose, size = "details", description, footer, busy = false, busyLabel = "Confirming your request. Please wait before closing.", initialFocus, selectInitial = false, onKeyDown }: {
  title: string; children: React.ReactNode; onClose: () => void;
  size?: "confirm" | "form" | "details" | "media";
  description?: React.ReactNode; footer?: React.ReactNode;
  busy?: boolean; busyLabel?: string; initialFocus?: string; selectInitial?: boolean;
  onKeyDown?: React.KeyboardEventHandler<HTMLDialogElement>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const busyId = useId();
  const backdropPress = useRef(false);
  useEffect(() => {
    const dialog = ref.current;
    const previousFocus = document.activeElement;
    const unlock = lockModalScroll();
    dialog?.showModal();
    const frame = requestAnimationFrame(() => {
      const target = (initialFocus ? dialog?.querySelector<HTMLElement>(initialFocus) : null) || dialog?.querySelector<HTMLElement>("[data-modal-autofocus]") || dialog?.querySelector<HTMLElement>("h2");
      target?.focus({ preventScroll: true });
      if (selectInitial && target instanceof HTMLInputElement) target.select();
    });
    return () => {
      cancelAnimationFrame(frame);
      dialog?.close();
      unlock();
      // React may already have detached the dialog when native close runs.
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected && !previousFocus.closest("[inert]")) previousFocus.focus({ preventScroll: true });
    };
  }, [initialFocus, selectInitial]);
  const close = () => { if (!busy) onClose(); };
  const outside = (x: number, y: number, dialog: HTMLDialogElement) => { const rect = dialog.getBoundingClientRect(); return x < rect.left || x > rect.right || y < rect.top || y > rect.bottom; };
  return <dialog ref={ref} className="modal" data-size={size} aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} onKeyDown={onKeyDown} onCancel={(event) => { event.preventDefault(); close(); }} onPointerDown={event => { backdropPress.current = event.target === event.currentTarget && outside(event.clientX, event.clientY, event.currentTarget); }} onPointerCancel={() => { backdropPress.current = false; }} onClick={event => { const dismiss = backdropPress.current && event.target === event.currentTarget && outside(event.clientX, event.clientY, event.currentTarget); backdropPress.current = false; if (dismiss) close(); }}>
    <div className="modal-inner"><header className="modal-header"><h2 id={titleId} tabIndex={-1}>{title}</h2><button type="button" className="icon-button" aria-label="Close dialog" disabled={busy} aria-describedby={busy ? busyId : undefined} onClick={close}><X size={20} /></button></header>
      {busy && <p className="modal-busy" id={busyId} role="status"><Loader2 size={16} className="spin" />{busyLabel}</p>}
      <div className="modal-body">{description && <p className="modal-description" id={descriptionId}>{description}</p>}{children}</div>
      {footer && <footer className="modal-footer">{footer}</footer>}
    </div>
  </dialog>;
}
export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  return <button ref={ref} className="button small" onClick={async () => {
    try { await navigator.clipboard.writeText(value); if (ref.current) ref.current.textContent = "Copied"; setTimeout(() => { if (ref.current) ref.current.textContent = label; }, 1800); }
    catch { if (ref.current) ref.current.textContent = "Select and copy"; }
  }}>{label}</button>;
}
