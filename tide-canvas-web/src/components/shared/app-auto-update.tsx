"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  APP_UPDATE_BEFORE_RELOAD_EVENT,
  APP_UPDATE_CAN_RELOAD_EVENT,
  CURRENT_APP_VERSION,
} from "@/lib/app-update";
import { toast } from "@/components/shared/toast";
import { useAppUpdateGuard } from "@/hooks/use-app-update-guard";

const NORMAL_CHECK_MS = 30_000;
const CONFIRM_CHECK_MS = 5_000;
const BLOCKED_RETRY_MS = 5_000;
const RELOAD_MARKER_KEY = "flowinglight:auto-update-reload";

interface ReloadMarker {
  target: string;
  count: number;
  savedAt: number;
}

function reloadAttemptAllowed(target: string): boolean {
  try {
    const marker = JSON.parse(sessionStorage.getItem(RELOAD_MARKER_KEY) || "null") as ReloadMarker | null;
    const recent = marker?.target === target && Date.now() - marker.savedAt < 5 * 60 * 1000;
    if (recent && marker.count >= 3) return false;
    sessionStorage.setItem(RELOAD_MARKER_KEY, JSON.stringify({
      target,
      count: recent ? marker.count + 1 : 1,
      savedAt: Date.now(),
    } satisfies ReloadMarker));
  } catch {
    // Storage is only a reload-loop fuse. Version confirmation still keeps the
    // normal path safe when storage is unavailable.
  }
  return true;
}

export function AppAutoUpdate() {
  const pathname = usePathname();
  const [dirtyPath, setDirtyPath] = useState<string | null>(null);
  const hasDedicatedDraftRecovery = pathname === "/studio" || pathname === "/chat" ||
    (pathname.startsWith("/canvas/") && pathname !== "/canvas/new");

  // Pages without a dedicated snapshot (admin/account/login forms, etc.) fail
  // closed after the user edits a field. Navigation changes `pathname`, which
  // releases the old route's guard and lets the new page update automatically.
  useEffect(() => {
    if (hasDedicatedDraftRecovery) return;
    const markDirty = (event: Event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const editable = target.matches("input, textarea, select, [contenteditable='true']") ||
        !!target.closest("[contenteditable='true']");
      if (!editable) return;
      setDirtyPath(pathname);
    };
    document.addEventListener("input", markDirty, true);
    document.addEventListener("change", markDirty, true);
    return () => {
      document.removeEventListener("input", markDirty, true);
      document.removeEventListener("change", markDirty, true);
    };
  }, [hasDedicatedDraftRecovery, pathname]);

  useAppUpdateGuard(!hasDedicatedDraftRecovery && dirtyPath === pathname, () => {});

  useEffect(() => {
    if (!CURRENT_APP_VERSION || CURRENT_APP_VERSION === "development") return;

    let stopped = false;
    let checking = false;
    let timer: number | null = null;
    let candidate = "";
    let confirmations = 0;
    let reloading = false;

    const schedule = (delay: number) => {
      if (stopped || reloading) return;
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => void check(), delay);
    };

    const attemptReload = (target: string) => {
      const guardEvent = new Event(APP_UPDATE_CAN_RELOAD_EVENT, { cancelable: true });
      if (!window.dispatchEvent(guardEvent)) {
        schedule(BLOCKED_RETRY_MS);
        return;
      }
      const persistEvent = new CustomEvent(APP_UPDATE_BEFORE_RELOAD_EVENT, {
        cancelable: true,
        detail: { targetVersion: target },
      });
      if (!window.dispatchEvent(persistEvent)) {
        schedule(BLOCKED_RETRY_MS);
        return;
      }
      if (!reloadAttemptAllowed(target)) {
        schedule(NORMAL_CHECK_MS);
        return;
      }
      reloading = true;
      toast.info("发现新版本，正在自动更新…");
      window.setTimeout(() => window.location.reload(), 280);
    };

    const check = async () => {
      if (stopped || checking || reloading) return;
      checking = true;
      try {
        const response = await fetch(`/app-version?t=${Date.now()}`, {
          cache: "no-store",
          credentials: "same-origin",
          headers: { Accept: "text/plain" },
        });
        if (!response.ok) throw new Error("version check failed");
        const deployed = (await response.text()).trim();
        if (!deployed || deployed === CURRENT_APP_VERSION) {
          candidate = "";
          confirmations = 0;
          try {
            sessionStorage.removeItem(RELOAD_MARKER_KEY);
          } catch {
            // Ignore storage denial.
          }
          schedule(NORMAL_CHECK_MS);
          return;
        }
        if (candidate === deployed) confirmations += 1;
        else {
          candidate = deployed;
          confirmations = 1;
        }
        if (confirmations >= 2) attemptReload(deployed);
        else schedule(CONFIRM_CHECK_MS);
      } catch {
        schedule(NORMAL_CHECK_MS);
      } finally {
        checking = false;
      }
    };

    const checkWhenActive = () => {
      if (document.visibilityState === "visible") void check();
    };
    void check();
    window.addEventListener("focus", checkWhenActive);
    window.addEventListener("online", checkWhenActive);
    document.addEventListener("visibilitychange", checkWhenActive);
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
      window.removeEventListener("focus", checkWhenActive);
      window.removeEventListener("online", checkWhenActive);
      document.removeEventListener("visibilitychange", checkWhenActive);
    };
  }, [pathname]);

  return null;
}
