"use client";

import { useMemo, useState } from "react";
import { Headset, X, Loader2 } from "lucide-react";
import { ChatWindow } from "@/components/im/chat-window";
import { useImStore } from "@/stores/use-im-store";
import { useAuthStore } from "@/stores/use-auth-store";
import { imApi } from "@/lib/api";

/**
 * 用户端在线客服悬浮窗：右下角气泡，点开直接与客服对话（support 会话）。
 * 复用 ChatWindow；与 header 的「私信」抽屉相互独立，共享同一 store。
 */
export function SupportWidget() {
  const [open, setOpen] = useState(false);
  const [opening, setOpening] = useState(false);

  const conversations = useImStore((s) => s.conversations);
  const messages = useImStore((s) => s.messages);
  const loadingMsgs = useImStore((s) => s.loadingMsgs);
  const setActive = useImStore((s) => s.setActive);
  const send = useImStore((s) => s.send);
  const recall = useImStore((s) => s.recall);
  const isOnline = useImStore((s) => s.isOnline);
  const upsertConversation = useImStore((s) => s.upsertConversation);

  const currentUserId = useAuthStore((s) => s.user?.id);
  const currentUserIdStr = currentUserId == null ? null : String(currentUserId);

  // 客服会话（用户侧通常一个）与未读数
  const supportConv = useMemo(
    () => conversations.find((c) => c.type === "support") ?? null,
    [conversations],
  );
  const unread = useMemo(
    () => conversations.filter((c) => c.type === "support").reduce((sum, c) => sum + (c.unread || 0), 0),
    [conversations],
  );
  const supportMessages = supportConv ? messages[supportConv.id] ?? [] : [];

  // 打开：取/建客服会话并激活；关闭：仅收起窗口。
  const toggle = async () => {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (opening) return;
    setOpening(true);
    try {
      let conv = supportConv;
      if (!conv) {
        const res = await imApi.openSupport();
        if (res.success && res.data) { upsertConversation(res.data); conv = res.data; }
      }
      if (conv) setActive(conv.id);
    } finally {
      setOpening(false);
    }
  };

  const handleSend = (content: string) => {
    if (!supportConv) return Promise.resolve(false);
    return send(supportConv.id, content);
  };
  const handleRecall = (msgId: string) => {
    if (supportConv) void recall(supportConv.id, msgId);
  };

  return (
    <>
      {open && (
        <div className="fixed bottom-24 right-6 z-50 flex h-[480px] w-[360px] max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl">
          <div className="flex items-center justify-between border-b border-border bg-muted/50 px-4 py-2.5">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Headset className="h-4 w-4" /> 在线客服
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="关闭" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1">
            {opening && !supportConv ? (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
              </div>
            ) : (
              <ChatWindow
                conversation={supportConv}
                messages={supportMessages}
                loading={loadingMsgs}
                currentUserId={currentUserIdStr}
                isOnline={isOnline}
                onSend={handleSend}
                onRecall={handleRecall}
                onBack={() => setOpen(false)}
              />
            )}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => void toggle()}
        aria-label="在线客服"
        className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-neutral-900 text-white shadow-lg transition-transform hover:scale-105 dark:bg-white dark:text-neutral-900"
      >
        {open ? <X className="h-6 w-6" /> : <Headset className="h-6 w-6" />}
        {!open && unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-medium text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
    </>
  );
}
