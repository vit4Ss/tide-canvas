"use client";

/* ── in-flight task polling (extracted verbatim from page.tsx) ──────────────── */

import { useEffect, useMemo } from "react";
import { AiTaskStatus } from "@/types/ai";
import type { MessageVO } from "@/types/chat";

/** 轮询：当前对话有任务在进行(status processing) → 每 1.5s 刷新消息（task 为真相，
 *  状态/结果由后端 join 回来）；页面不可见时跳过；送出中暂停，避免覆盖乐观气泡。 */
export function useTaskPolling({
  msgs,
  activeId,
  busy,
  loadMessages,
}: {
  msgs: MessageVO[];
  activeId: string | null;
  busy: boolean;
  loadMessages: (id: string) => Promise<void>;
}) {
  const hasInflight = useMemo(
    () =>
      msgs.some(
        (message) =>
          (message.task && message.task.status === AiTaskStatus.PROCESSING) ||
          message.skillRun?.status === "queued" ||
          message.skillRun?.status === "running",
      ),
    [msgs],
  );
  useEffect(() => {
    if (!hasInflight || !activeId || busy) return;
    const iv = setInterval(() => {
      if (document.visibilityState === "visible") loadMessages(activeId);
    }, 1500);
    return () => clearInterval(iv);
  }, [hasInflight, activeId, busy, loadMessages]);
}
