"use client";

/* ── text streaming state (P4, extracted verbatim from page.tsx) ────────────── */

import { useCallback, useEffect, useRef, useState } from "react";

/** 文本流式回复：进行中的 assistant 增量 + 中止控制器（切对话 / 卸载时 abort）。
 *  activeIdRef 镜像由 useConversations 持有（send/resume 用它防切对话覆盖）。 */
export function useStreaming() {
  // text streaming (P4): the in-progress assistant reply for the active
  // conversation + the abort controller (cancelled on switch / unmount).
  const [streaming, setStreaming] = useState<string | null>(null);
  const chatAbortRef = useRef<AbortController | null>(null);

  // abort a residual stream on unmount (stop burning tokens upstream).
  useEffect(() => {
    return () => chatAbortRef.current?.abort();
  }, []);

  // 停掉进行中的文本流：中止请求并撤下流式气泡。切会话 / 新建会话 / 删除当前
  // 会话都必须调——流式气泡渲染在 msgs 之后、不挑会话，漏掉任何一处，幽灵
  // 气泡就会渗进切换后的会话继续打字。
  const stopStream = useCallback(() => {
    chatAbortRef.current?.abort();
    chatAbortRef.current = null;
    setStreaming(null);
  }, []);

  return { streaming, setStreaming, chatAbortRef, stopStream };
}

export type StreamingApi = ReturnType<typeof useStreaming>;
