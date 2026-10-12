"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

const query = "(max-width: 800px)";
const subscribe = (notify: () => void) => {
  const media = window.matchMedia(query);
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
};
const getSnapshot = () => window.matchMedia(query).matches;
const getServerSnapshot = () => false;

/** Shared dismissal behavior; only the workspace drawer traps focus and scrolling. */
export function useMobileNavigation(modal = false) {
  const mobile = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const active = mobile && open;

  useEffect(() => {
    const media = window.matchMedia(query);
    const close = () => setOpen(false);
    media.addEventListener("change", close);
    return () => media.removeEventListener("change", close);
  }, []);

  useEffect(() => {
    const panel = panelRef.current;
    const trigger = triggerRef.current;
    if (!active || !panel) return;
    const controls = () => Array.from(panel.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex="0"]',
    )).filter((element) => element.getClientRects().length > 0);
    const focusFirst = () => (panel.querySelector<HTMLElement>("[data-close-navigation]") || controls()[0])?.focus();
    const previousOverflow = document.body.style.overflow;
    if (modal) {
      document.body.style.overflow = "hidden";
    }
    // Let the browser apply the visibility/inert change before moving focus.
    const focusFrame = modal ? window.requestAnimationFrame(focusFirst) : 0;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        trigger?.focus();
      } else if (modal && event.key === "Tab") {
        const items = controls();
        const first = items[0];
        const last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first?.focus();
        }
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!panel.contains(event.target as Node) && !trigger?.contains(event.target as Node)) setOpen(false);
    };
    const onFocus = (event: FocusEvent) => {
      if (modal && !panel.contains(event.target as Node)) focusFirst();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("focusin", onFocus);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("focusin", onFocus);
      if (modal) {
        document.body.style.overflow = previousOverflow;
        if (trigger?.getClientRects().length && (panel.contains(document.activeElement) || document.activeElement === document.body)) trigger.focus();
      }
    };
  }, [active, modal]);

  return { open: active, setOpen, mobile, panelRef, triggerRef };
}
