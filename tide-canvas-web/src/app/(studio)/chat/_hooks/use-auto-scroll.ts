"use client";

/* ── thread auto-scroll (P5, extracted verbatim from page.tsx) ──────────────── */

import { useCallback, useEffect, useRef, useState } from "react";
import type { MessageVO } from "@/types/chat";

/** 自动滚动：仅当用户停留在接近底部时跟随新内容，否则浮出「跳到最新」按钮；
 *  送出 / 切对话强制回底。 */
export function useAutoScroll({
  msgs,
  typing,
  activeId,
}: {
  msgs: MessageVO[];
  typing: boolean;
  activeId: string | null;
}) {
  const threadRef = useRef<HTMLDivElement>(null);

  // auto-scroll (P5): follow only when the user is near the bottom; otherwise
  // surface a 跳到最新 button instead of yanking them down mid-read.
  const nearBottomRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  // keep the thread pinned to the bottom on new content
  const scrollEnd = useCallback(() => {
    const t = threadRef.current;
    if (t) t.scrollTop = t.scrollHeight;
  }, []);

  // force a jump to the latest (on send / conversation switch).
  const forceBottom = useCallback(() => {
    nearBottomRef.current = true;
    setShowJump(false);
    requestAnimationFrame(scrollEnd);
  }, [scrollEnd]);

  // track whether the user is reading near the bottom.
  const onThreadScroll = useCallback(() => {
    const t = threadRef.current;
    if (!t) return;
    const near = t.scrollHeight - t.scrollTop - t.clientHeight < 120;
    nearBottomRef.current = near;
    if (near) setShowJump(false);
  }, []);

  // passive content updates (polling/stream) follow only when near the bottom;
  // otherwise reveal the jump button.
  useEffect(() => {
    if (nearBottomRef.current) scrollEnd();
    else setShowJump(true);
  }, [msgs, typing, scrollEnd]);

  // selecting/switching a conversation forces a jump to its latest.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 切会话强制回底部（内部复位 showJump），一次性
    forceBottom();
  }, [activeId, forceBottom]);

  return { threadRef, nearBottomRef, showJump, scrollEnd, forceBottom, onThreadScroll };
}

export type AutoScrollApi = ReturnType<typeof useAutoScroll>;
