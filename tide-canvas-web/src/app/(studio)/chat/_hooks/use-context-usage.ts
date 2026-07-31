"use client";

/* ── context-window usage (extracted verbatim from page.tsx) ────────────────── */

import { useCallback, useEffect, useState } from "react";
import { chatApi } from "@/lib/chat-api";
import type { ContextUsageVO } from "@/types/chat";

/** context-window usage (like GPT/Claude 的会话上限): fetched when a conversation
 *  is opened and after each committed turn. ≥80% shows a 开启新会话 warning bar;
 *  full blocks text sends (the server enforces the cap too — CONTEXT_LIMIT).
 *  Stored keyed by conversation so switching never shows another thread's bar. */
export function useContextUsage(activeId: string | null) {
  const [ctxUsageFor, setCtxUsageFor] = useState<{ id: string; usage: ContextUsageVO } | null>(null);
  const ctxUsage = ctxUsageFor && ctxUsageFor.id === activeId ? ctxUsageFor.usage : null;
  const refreshCtxUsage = useCallback(async (id: string) => {
    const res = await chatApi.contextUsage(id);
    if (res.success && res.data) setCtxUsageFor({ id, usage: res.data });
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- setState fires after an await (async fetch), not synchronously
    if (activeId) refreshCtxUsage(activeId);
  }, [activeId, refreshCtxUsage]);
  return { ctxUsage, refreshCtxUsage };
}

export type ContextUsageApi = ReturnType<typeof useContextUsage>;
