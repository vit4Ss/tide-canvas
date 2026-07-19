"use client";

import type { RefObject } from "react";
import { FileText, Loader2, Sparkles } from "lucide-react";
import { SUGGESTIONS } from "./constants";
import { formatFileSize } from "./format";
import type { AssistantChatMessage } from "./types";

interface AssistantMessageListProps {
  messages: AssistantChatMessage[];
  messagesEndRef: RefObject<HTMLDivElement | null>;
}

export function AssistantMessageList({ messages, messagesEndRef }: AssistantMessageListProps) {
  if (messages.length === 0) {
    return (
      <div className="mx-auto w-full max-w-[330px]">
        <div className="mb-7 flex h-11 w-11 items-center justify-center rounded-2xl bg-red-100 text-red-500 dark:bg-white/6 dark:text-red-400">
          <Sparkles className="h-5 w-5" />
        </div>
        <h2 className="text-[28px] font-bold leading-tight tracking-normal text-neutral-950 dark:text-neutral-100">
          <span className="text-red-500 dark:text-red-400">快来和AI小助理</span>聊天吧
        </h2>
        <ul className="mt-6 space-y-4 text-[15px] text-neutral-600 dark:text-red-200/90">
          {SUGGESTIONS.map((item) => (
            <li key={item} className="flex items-center gap-3">
              <span className="h-2 w-2 rounded-full bg-red-500 dark:bg-red-400" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-4 pr-1">
      <div className="space-y-4 pt-2">
        {messages.map((item) => {
          const isUser = item.role === "user";
          return (
            <div key={item.id} className={(isUser ? "justify-end" : "justify-start") + " flex"}>
              <div
                className={(isUser
                  ? "bg-neutral-950 text-white dark:bg-white dark:text-neutral-950"
                  : item.status === "error"
                    ? "bg-red-50 text-red-600 ring-1 ring-red-100 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/20"
                    : "bg-white text-neutral-900 ring-1 ring-neutral-200/70 dark:bg-[#24252a] dark:text-neutral-100 dark:ring-white/8") + " max-w-[84%] rounded-2xl px-3.5 py-2.5 text-sm leading-6 shadow-sm"}
              >
                <div className="whitespace-pre-wrap break-words">
                  {item.status === "pending" && (
                    <span className="mr-2 inline-flex align-[-2px]">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    </span>
                  )}
                  {item.content}
                </div>
                {item.attachments && item.attachments.length > 0 && (
                  <div className="mt-2 space-y-1.5">
                    {item.attachments.map((file) => (
                      <div
                        key={file.fileUrl}
                        className={(isUser ? "bg-white/12 text-white/85 dark:bg-neutral-950/8 dark:text-neutral-700" : "bg-neutral-50 text-neutral-600 dark:bg-white/6 dark:text-neutral-300") + " flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs"}
                      >
                        <FileText className="h-3.5 w-3.5 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">{file.originalName}</span>
                        <span className="shrink-0 opacity-70">{formatFileSize(file.fileSize)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}
