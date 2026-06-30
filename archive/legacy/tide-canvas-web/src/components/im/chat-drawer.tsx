"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConversationList } from "@/components/im/conversation-list";
import { ChatWindow } from "@/components/im/chat-window";
import { useImStore } from "@/stores/use-im-store";
import { useAuthStore } from "@/stores/use-auth-store";
import { cn } from "@/lib/utils";

interface ChatDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// 用户端「私信」弹窗：抖音式居中大模态框（左会话列表 + 右聊天窗）。
// 客服已独立为右下角悬浮窗（SupportWidget）。
export function ChatDrawer({ open, onOpenChange }: ChatDrawerProps) {
  const conversations = useImStore((s) => s.conversations);
  const activeId = useImStore((s) => s.activeId);
  const messages = useImStore((s) => s.messages);
  const loadingConvs = useImStore((s) => s.loadingConvs);
  const loadingMsgs = useImStore((s) => s.loadingMsgs);
  const loadConversations = useImStore((s) => s.loadConversations);
  const setActive = useImStore((s) => s.setActive);
  const send = useImStore((s) => s.send);
  const recall = useImStore((s) => s.recall);
  const isOnline = useImStore((s) => s.isOnline);

  // 移动端在「列表」与「聊天」两个面板间切换（桌面端两栏并存）。
  const [mobileView, setMobileView] = useState<"list" | "chat">("list");

  const currentUserId = useAuthStore((s) => s.user?.id);
  const currentUserIdStr =
    currentUserId === undefined || currentUserId === null ? null : String(currentUserId);

  // 打开弹窗即拉取会话列表。
  useEffect(() => {
    if (open) void loadConversations();
  }, [open, loadConversations]);

  // 弹窗只展示私信；客服在右下角悬浮窗。
  const privateConvs = useMemo(
    () => conversations.filter((c) => c.type === "private"),
    [conversations],
  );

  const activeConv = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  );
  const activeMessages = activeId ? messages[activeId] ?? [] : [];

  const handleSelect = (id: string) => {
    setActive(id);
    setMobileView("chat");
  };
  const handleSend = (content: string) => {
    if (!activeId) return Promise.resolve(false);
    return send(activeId, content);
  };
  const handleRecall = (msgId: string) => {
    if (!activeId) return;
    void recall(activeId, msgId);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[78vh] max-h-[620px] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl md:max-w-4xl">
        <DialogHeader className="shrink-0 border-b border-border px-4 py-3">
          <DialogTitle>私信</DialogTitle>
          <DialogDescription className="sr-only">用户私信会话</DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1">
          {/* 左列：私信会话列表 */}
          <div
            className={cn(
              "flex w-full flex-col border-border md:w-72 md:shrink-0 md:border-r",
              mobileView === "chat" ? "hidden md:flex" : "flex",
            )}
          >
            <div className="min-h-0 flex-1 overflow-y-auto">
              <ConversationList
                conversations={privateConvs}
                activeId={activeId}
                loading={loadingConvs}
                isOnline={isOnline}
                onSelect={handleSelect}
              />
            </div>
          </div>

          {/* 右列：聊天窗 */}
          <div
            className={cn(
              "min-h-0 flex-1",
              mobileView === "list" ? "hidden md:flex" : "flex",
            )}
          >
            <ChatWindow
              conversation={activeConv}
              messages={activeMessages}
              loading={loadingMsgs}
              currentUserId={currentUserIdStr}
              isOnline={isOnline}
              onSend={handleSend}
              onRecall={handleRecall}
              onBack={() => setMobileView("list")}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
