"use client";

import type { RefObject } from "react";
import { ChevronDown, Menu, Plus } from "lucide-react";
import { formatSessionTime, sessionPreviewFromMessages, sessionUserMessageCount } from "./format";
import type { AssistantStoredSession } from "./types";

interface AssistantHistoryMenuProps {
  rootRef: RefObject<HTMLDivElement | null>;
  open: boolean;
  sessions: AssistantStoredSession[];
  activeSessionId: string;
  onOpenChange: (open: boolean) => void;
  onStartNewSession: () => void;
  onSelectSession: (session: AssistantStoredSession) => void;
  align?: "left" | "right";
}

export function AssistantHistoryMenu({
  rootRef,
  open,
  sessions,
  activeSessionId,
  onOpenChange,
  onStartNewSession,
  onSelectSession,
  align = "right",
}: AssistantHistoryMenuProps) {
  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className={(open ? "bg-neutral-950 text-white dark:bg-white dark:text-neutral-950" : "text-neutral-600 hover:bg-neutral-200/70 hover:text-neutral-950 dark:text-neutral-200 dark:hover:bg-white/10 dark:hover:text-white") + " inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium transition-colors"}
        title="历史会话"
        aria-expanded={open}
      >
        <Menu className="h-4 w-4" />
        <span>历史</span>
        <ChevronDown className={(open ? "rotate-180" : "rotate-0") + " h-3.5 w-3.5 transition-transform"} />
      </button>

      {open && (
        <div className={(align === "left" ? "left-0" : "right-0") + " absolute top-10 z-40 w-[320px] max-w-[calc(100vw-48px)] overflow-hidden rounded-2xl border border-neutral-200/80 bg-white text-sm text-neutral-800 shadow-2xl shadow-neutral-900/15 dark:border-white/10 dark:bg-[#25262b] dark:text-neutral-100"}>
          <div className="flex items-center justify-between gap-3 border-b border-neutral-100 px-3 py-3 dark:border-white/8">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-neutral-950 dark:text-white">历史会话</div>
              <div className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                {sessions.length ? "共 " + sessions.length + " 个会话" : "最近会话会保存在这里"}
              </div>
            </div>
            <button
              type="button"
              onClick={onStartNewSession}
              className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg bg-neutral-950 px-2.5 text-xs font-medium text-white transition-colors hover:bg-neutral-800 dark:bg-white dark:text-neutral-950 dark:hover:bg-neutral-200"
            >
              <Plus className="h-3.5 w-3.5" />
              新建
            </button>
          </div>

          <div className="max-h-[360px] overflow-y-auto p-2">
            {sessions.length ? sessions.map((session) => {
              const isActive = session.id === activeSessionId;
              const questionCount = sessionUserMessageCount(session);
              const preview = sessionPreviewFromMessages(session.messages);
              return (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => onSelectSession(session)}
                  className={(isActive
                    ? "border-neutral-950 bg-neutral-950 text-white dark:border-white dark:bg-white dark:text-neutral-950"
                    : "border-neutral-200 bg-neutral-50/70 text-neutral-800 hover:border-neutral-300 hover:bg-neutral-100 dark:border-white/8 dark:bg-white/5 dark:text-neutral-100 dark:hover:border-white/15 dark:hover:bg-white/10") + " mb-2 block w-full rounded-xl border px-3 py-3 text-left transition-colors last:mb-0"}
                  title={session.title}
                >
                  <span className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{session.title}</span>
                      <span className={(isActive ? "text-white/65 dark:text-neutral-600" : "text-neutral-500 dark:text-neutral-400") + " mt-1 block truncate text-xs"}>
                        {questionCount ? questionCount + " 条提问" : session.messages.length + " 条消息"} · {formatSessionTime(session.updatedAt)}
                      </span>
                    </span>
                    {isActive && (
                      <span className="shrink-0 rounded-full bg-emerald-400/20 px-2 py-0.5 text-[11px] font-medium text-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-700">
                        当前
                      </span>
                    )}
                  </span>
                  <span className={(isActive ? "text-white/70 dark:text-neutral-600" : "text-neutral-500 dark:text-neutral-400") + " mt-2 block truncate text-xs leading-5"}>
                    {preview}
                  </span>
                </button>
              );
            }) : (
              <div className="rounded-xl border border-dashed border-neutral-200 px-4 py-8 text-center dark:border-white/10">
                <Menu className="mx-auto h-5 w-5 text-neutral-400 dark:text-neutral-500" />
                <div className="mt-3 text-sm font-medium text-neutral-700 dark:text-neutral-200">暂无历史会话</div>
                <div className="mt-1 text-xs leading-5 text-neutral-500 dark:text-neutral-400">
                  发送第一条消息后，就可以在这里快速切换。
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
