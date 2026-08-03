"use client";

/* ── orphaned-turn stream resume (extracted verbatim from page.tsx) ──────────── */

import { useEffect, useRef } from "react";
import { chatApi, streamLive } from "@/lib/chat-api";
import type { MessageVO } from "@/types/chat";

// Mirrors the server's 10 minute provider bound plus its 2 minute safety
// margin. A cross-device browser has no local journal, so live/history resume
// must remain available for the full durable lease rather than the old 200s.
const LIVE_RESUME_WINDOW_MS = 12 * 60 * 1000;
const LIVE_RESUME_RETRY_MS = 3000;
const LIVE_RESUME_MAX_TRIES = Math.ceil(LIVE_RESUME_WINDOW_MS / LIVE_RESUME_RETRY_MS) + 2;

// —— 刷新/切页后的接续（GPT/Claude 式断线续播）——
// 服务端断连后仍继续生成并缓存增量（chat/live.go）。文本轮次里用户消息先
// 落库、回复生成完才落库，所以「最后一条仍在服务端硬租约内的孤儿用户文本消息」
// = 服务端可能还在生成：附着 GET /stream 续播——先收到已生成快照，再逐字
// 直播，终态后拉取落库消息。附着到 none/出错（可能刚好落库、或服务端重
// 启）→ 拉一次消息，仍是孤儿则 3s 后重试；窗口覆盖服务端完整 12m 租约，
// 超窗后由消息列表的后端终态化/退款兜底。本地发送中（busy）不介入；条件里刻意
// 不看 streaming——附着自身会置流式态，看了会自我打断。
export function useResumeStream({
  msgs,
  activeId,
  busy,
  setMsgs,
  setStreaming,
  nearBottomRef,
  scrollEnd,
  refreshCtxUsage,
}: {
  msgs: MessageVO[];
  activeId: string | null;
  busy: boolean;
  setMsgs: React.Dispatch<React.SetStateAction<MessageVO[]>>;
  setStreaming: React.Dispatch<React.SetStateAction<string | null>>;
  nearBottomRef: React.RefObject<boolean>;
  scrollEnd: () => void;
  refreshCtxUsage: (id: string) => Promise<void>;
}) {
  const lastMsg = msgs[msgs.length - 1];
  const resumeId =
    !busy && !!lastMsg && lastMsg.role === "user" && !lastMsg.taskId ? lastMsg.id : null;
  const resumeAt = resumeId ? lastMsg.createTime : null;
  const resumeRequestId = resumeId ? lastMsg.clientRequestId : undefined;
  const msgsRef = useRef(msgs);
  useEffect(() => {
    msgsRef.current = msgs;
  }, [msgs]);
  useEffect(() => {
    if (!resumeId || !resumeAt || !activeId) return;
    const convId = activeId;
    const ac = new AbortController();
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    (async () => {
      await sleep(0); // 让出同步栈（effect 体内禁止同步 setState）
      // 时效窗口依赖客户端与服务端的时钟差：解析失败(NaN)直接不接续,
      // 客户端时钟偏慢时窗口判断失效,由硬性次数上限兜底(约 200s/3s)。
      const sentAt = new Date(resumeAt).getTime();
      if (!Number.isFinite(sentAt)) return;
      let tries = 0;
      for (;;) {
        if (ac.signal.aborted) return;
        if (Date.now() - sentAt >= LIVE_RESUME_WINDOW_MS || ++tries > LIVE_RESUME_MAX_TRIES) return;
        setStreaming((cur) => (cur === null ? "" : cur)); // "" = 思考中气泡
        let acc = "";
        let final: MessageVO | null = null;
        await streamLive(convId, {
          signal: ac.signal,
          clientRequestId: resumeRequestId,
          onDelta: (d) => {
            acc += d;
            setStreaming(acc);
            if (nearBottomRef.current) requestAnimationFrame(scrollEnd);
          },
          onDone: (m) => {
            final = m;
          },
        });
        if (ac.signal.aborted) return;
        setStreaming(null);
        // 写回一律走「当前线程仍以这条孤儿消息收尾」的状态守卫，而不是
        // loadMessages——后者会自增 reqId,与切会话瞬间的加载存在竞态窗口,
        // 输了会把旧会话消息灌进新会话视图;状态守卫在内容层面杜绝了污染。
        if (final) {
          const done: MessageVO = final;
          if (done.conversationId === convId) {
            setMsgs((cur) => {
              const l = cur[cur.length - 1];
              return l && l.id === resumeId ? [...cur, done] : cur;
            });
            refreshCtxUsage(convId); // 存储按会话 id 键控,跨会话调用无污染
          }
          return;
        }
        // none / 断流：可能刚好落库或服务端重启——拉一次消息按守卫替换，
        // 仍是孤儿则按节奏重试
        try {
          const res = await chatApi.latestMessages(convId);
          if (res.success && res.data) {
            const records = res.data.records;
            setMsgs((cur) => {
              const l = cur[cur.length - 1];
              return l && l.id === resumeId ? records : cur;
            });
          }
        } catch {
          /* 网络抖动：按重试节奏继续 */
        }
        if (ac.signal.aborted) return;
        await sleep(LIVE_RESUME_RETRY_MS);
        const cur = msgsRef.current;
        const l = cur[cur.length - 1];
        if (!l || l.id !== resumeId) {
          refreshCtxUsage(convId); // 回复已落库（none 路径拉到的）：同步用量条
          return;
        }
      }
    })();
    // 中止只影响附着连接，服务端生成不受影响；流式气泡由接管方（切会话的
    // stopStream / 新发送的 send）负责撤下，这里不动状态。
    return () => ac.abort();
  }, [resumeId, resumeAt, resumeRequestId, activeId, scrollEnd, refreshCtxUsage, nearBottomRef, setMsgs, setStreaming]);
}
