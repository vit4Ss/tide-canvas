"use client";

import { useEffect, useRef } from "react";
import {
  APP_UPDATE_BEFORE_RELOAD_EVENT,
  APP_UPDATE_CAN_RELOAD_EVENT,
} from "@/lib/app-update";

/** Persist route-local draft state and delay automatic reload while a paid
 * submit/upload is still crossing its durability barrier. */
export function useAppUpdateGuard(blocked: boolean, persist: (targetVersion: string) => void): void {
  const blockedRef = useRef(blocked);
  const persistRef = useRef(persist);

  useEffect(() => {
    blockedRef.current = blocked;
    persistRef.current = persist;
  }, [blocked, persist]);

  useEffect(() => {
    const canReload = (event: Event) => {
      if (blockedRef.current) event.preventDefault();
    };
    const beforeUpdate = (event: Event) => {
      try {
        const targetVersion = event instanceof CustomEvent && typeof event.detail?.targetVersion === "string"
          ? event.detail.targetVersion
          : "";
        persistRef.current(targetVersion);
      } catch {
        // Hardened/private browsing can deny sessionStorage. This event only
        // fires after all paid-operation guards have declared the reload safe.
        event.preventDefault();
      }
    };
    window.addEventListener(APP_UPDATE_CAN_RELOAD_EVENT, canReload);
    window.addEventListener(APP_UPDATE_BEFORE_RELOAD_EVENT, beforeUpdate);
    return () => {
      window.removeEventListener(APP_UPDATE_CAN_RELOAD_EVENT, canReload);
      window.removeEventListener(APP_UPDATE_BEFORE_RELOAD_EVENT, beforeUpdate);
    };
  }, []);
}
