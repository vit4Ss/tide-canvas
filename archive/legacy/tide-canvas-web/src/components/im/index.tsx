"use client";

import { useEffect, useState } from "react";
import { MessageCircle } from "lucide-react";
import { ChatDrawer } from "@/components/im/chat-drawer";
import { useImStore } from "@/stores/use-im-store";

/**
 * 头部消息入口：图标按钮 + 未读角标，点击打开聊天侧边抽屉。
 * 同时负责 WebSocket 生命周期（登录态挂载 connect、卸载 disconnect）。
 *
 * 仅在登录态由 Header 渲染——故挂载即代表已登录，卸载/登出即断开。
 */
export function MessageEntry() {
  const [open, setOpen] = useState(false);
  const connect = useImStore((s) => s.connect);
  const disconnect = useImStore((s) => s.disconnect);
  // 未读总数：随 conversations 变化而响应式重算（不调用 totalUnread() 方法，确保订阅生效）。
  const totalUnread = useImStore((s) =>
    s.conversations.reduce((sum, c) => sum + (c.unread || 0), 0),
  );

  // 登录态建立 WS 连接；首次进入也拉一次会话列表以便角标即时显示。
  useEffect(() => {
    connect();
    void useImStore.getState().loadConversations();
    return () => disconnect();
  }, [connect, disconnect]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="消息"
        className="relative flex cursor-pointer items-center justify-center rounded-lg p-2 text-neutral-600 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-white"
      >
        <MessageCircle className="h-5 w-5" />
        {totalUnread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium text-white">
            {totalUnread > 99 ? "99+" : totalUnread}
          </span>
        )}
      </button>

      <ChatDrawer open={open} onOpenChange={setOpen} />
    </>
  );
}

export { ChatDrawer } from "@/components/im/chat-drawer";
export { SupportWidget } from "@/components/im/support-widget";
