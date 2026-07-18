"use client";

import {
  Check, ChevronLeft, ChevronRight, Copy, Download, FileText, FolderPlus, Image as ImageIcon,
  Loader2, Pencil, RefreshCw, Square, Video,
} from "lucide-react";
import type { ConversationMessageVO } from "@/types/conversation";
import { formatFileSize } from "@/lib/utils";
import { Markdown } from "@/components/shared/markdown";

interface Props {
  messages: ConversationMessageVO[];
  allMessages: ConversationMessageVO[];
  onCopy: (message: ConversationMessageVO) => void;
  onEdit: (message: ConversationMessageVO) => void;
  onRegenerate: (message: ConversationMessageVO) => void;
  onStop: (message: ConversationMessageVO) => void;
  onDownload: (message: ConversationMessageVO) => void;
  onAddToLibrary: (message: ConversationMessageVO) => void;
  onContinue: (message: ConversationMessageVO) => void;
  onSelectBranch: (message: ConversationMessageVO) => void;
}

function resultURLs(message: ConversationMessageVO): string[] {
  const values = Array.isArray(message.metadata?.urls)
    ? message.metadata.urls.filter((value): value is string => typeof value === "string" && value.length > 0)
    : [];
  const primary = typeof message.metadata?.url === "string" ? message.metadata.url : "";
  return Array.from(new Set([primary, ...values].filter(Boolean)));
}

function actionClass() {
  return "inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-white/8 dark:hover:text-white";
}

export function CreationMessageList({
  messages,
  allMessages,
  onCopy,
  onEdit,
  onRegenerate,
  onStop,
  onDownload,
  onAddToLibrary,
  onContinue,
  onSelectBranch,
}: Props) {
  return (
    <div className="mx-auto w-full max-w-[900px] space-y-7 pb-8 pt-4 text-left">
      {messages.map((message) => {
        const isUser = message.role === "user";
        const urls = resultURLs(message);
        const url = urls[0] ?? "";
        const isMedia = message.contentType === "image" || message.contentType === "video";
        const saved = message.metadata?.saved === true;
        const progress = typeof message.metadata?.progress === "number" ? message.metadata.progress : 0;
        const siblings = allMessages
          .filter((item) => item.role === message.role && item.parentMessageId === message.parentMessageId)
          .sort((a, b) => new Date(a.createTime).getTime() - new Date(b.createTime).getTime());
        const branchIndex = siblings.findIndex((item) => item.id === message.id);
        return (
          <article key={message.id} className="group/message">
            <div className={isUser ? "flex justify-end" : "flex justify-start"}>
              <div className={isUser
                ? "max-w-[78%] rounded-3xl rounded-br-lg bg-white px-4 py-3 text-[14px] leading-6 text-neutral-900 shadow-[0_10px_28px_rgba(15,23,42,0.08)] ring-1 ring-black/[0.08] dark:bg-white dark:text-neutral-950 dark:ring-white/15"
                : "w-full max-w-[86%] rounded-3xl rounded-bl-lg bg-white/90 px-4 py-4 text-[14px] leading-6 text-neutral-900 shadow-[0_14px_42px_rgba(15,23,42,0.08)] ring-1 ring-black/[0.05] backdrop-blur-xl dark:bg-white/7 dark:text-neutral-100 dark:ring-white/10"}
              >
                {!isUser && message.modelName && (
                  <div className="mb-2 flex items-center gap-1.5 text-[12px] text-neutral-400 dark:text-neutral-500">
                    {message.contentType === "video" ? <Video className="h-3.5 w-3.5" /> : message.contentType === "image" ? <ImageIcon className="h-3.5 w-3.5" /> : null}
                    <span>{message.modelName}</span>
                  </div>
                )}

                {message.status === "pending" || message.status === "streaming" ? (
                  message.status === "streaming" && !isMedia && message.content && message.content !== "正在思考..." ? (
                    <div className="relative pr-3">
                      <Markdown content={message.content} className="break-words text-[14px] leading-6" />
                      <span className="ml-1 inline-block h-4 w-1 animate-pulse rounded-full bg-neutral-400 align-middle" aria-label="正在生成" />
                    </div>
                  ) : (
                    <div className="flex min-h-10 items-center gap-2 text-neutral-500 dark:text-neutral-400">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>{message.content || (isMedia ? "正在生成..." : "正在思考...")}{isMedia && progress > 0 ? ` ${progress}%` : ""}</span>
                    </div>
                  )
                ) : message.status === "error" ? (
                  <p className="text-red-500">{message.content || "生成失败，请稍后重试。"}</p>
                ) : isMedia && url ? (
                  <div className="space-y-3">
                    {message.content && <p className="whitespace-pre-wrap break-words">{message.content}</p>}
                    {message.contentType === "video" ? (
                      <video src={url} controls className="max-h-[520px] w-auto max-w-full rounded-2xl border border-neutral-200 dark:border-white/10" />
                    ) : urls.length > 1 ? (
                      <div className="grid grid-cols-2 gap-2">
                        {urls.map((item, index) => (
                          <img key={item} src={item} alt={`${message.content || "生成图片"} ${index + 1}`} className="max-h-[420px] w-full rounded-2xl border border-neutral-200 object-contain dark:border-white/10" />
                        ))}
                      </div>
                    ) : (
                      <img src={url} alt={message.content || "生成图片"} className="max-h-[520px] w-auto max-w-full rounded-2xl border border-neutral-200 object-contain dark:border-white/10" />
                    )}
                  </div>
                ) : (
                  <Markdown content={message.content} colorMode={isUser ? "light" : "auto"} className="break-words text-[14px] leading-6" />
                )}

                {message.files.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {message.files.filter((file) => file.relation !== "result").map((file) => (
                      <div key={`${file.id}-${file.relation}`} className={isUser
                        ? "flex max-w-full items-center gap-2 rounded-xl bg-neutral-50 px-2.5 py-2 text-xs text-neutral-700 ring-1 ring-neutral-200/70 dark:bg-neutral-100 dark:text-neutral-700 dark:ring-neutral-200"
                        : "flex max-w-full items-center gap-2 rounded-xl bg-neutral-50 px-2.5 py-2 text-xs text-neutral-600 ring-1 ring-neutral-200/70 dark:bg-white/6 dark:text-neutral-300 dark:ring-white/10"}
                      >
                        <FileText className="h-3.5 w-3.5 shrink-0" />
                        <span className="max-w-[240px] truncate">{file.originalName}</span>
                        <span className="shrink-0 opacity-70">{formatFileSize(file.fileSize)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className={(isUser ? "justify-end pr-1" : "justify-start pl-1") + (siblings.length > 1 ? " opacity-100" : " opacity-0 group-hover/message:opacity-100 focus-within:opacity-100") + " mt-1 flex min-h-8 items-center transition-opacity"}>
              {siblings.length > 1 && (
                <span className="mr-1 inline-flex h-8 items-center gap-0.5 text-xs text-neutral-400">
                  <button type="button" className={actionClass()} disabled={branchIndex <= 0} onClick={() => onSelectBranch(siblings[branchIndex - 1])} aria-label="上一个分支">
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                  <span>{branchIndex + 1}/{siblings.length}</span>
                  <button type="button" className={actionClass()} disabled={branchIndex >= siblings.length - 1} onClick={() => onSelectBranch(siblings[branchIndex + 1])} aria-label="下一个分支">
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </span>
              )}
              {isUser ? (
                <button type="button" className={actionClass()} onClick={() => onEdit(message)} title="编辑消息">
                  <Pencil className="h-3.5 w-3.5" />编辑
                </button>
              ) : (
                <>
                  {message.status === "pending" || message.status === "streaming" ? (
                    <button type="button" className={actionClass()} onClick={() => onStop(message)} title="停止生成">
                      <Square className="h-3.5 w-3.5" />停止
                    </button>
                  ) : (
                    <>
                      {!isMedia && (
                        <button type="button" className={actionClass()} onClick={() => onCopy(message)} title="复制">
                          <Copy className="h-3.5 w-3.5" />复制
                        </button>
                      )}
                      <button type="button" className={actionClass()} onClick={() => onRegenerate(message)} title="重新生成">
                        <RefreshCw className="h-3.5 w-3.5" />重新生成
                      </button>
                      {isMedia && url && (
                        <>
                          <button type="button" className={actionClass()} onClick={() => onDownload(message)} title="下载">
                            <Download className="h-3.5 w-3.5" />下载
                          </button>
                          <button type="button" className={actionClass()} onClick={() => onContinue(message)} title="基于结果继续修改">
                            <Pencil className="h-3.5 w-3.5" />继续修改
                          </button>
                          <button type="button" className={actionClass()} onClick={() => onAddToLibrary(message)} disabled={saved} title="添加到素材库">
                            {saved ? <Check className="h-3.5 w-3.5" /> : <FolderPlus className="h-3.5 w-3.5" />}
                            {saved ? "已添加" : "添加到素材库"}
                          </button>
                        </>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
