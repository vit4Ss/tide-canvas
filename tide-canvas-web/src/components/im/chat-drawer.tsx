"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ConversationList } from "@/components/im/conversation-list";
import { ChatWindow } from "@/components/im/chat-window";
import { useImStore } from "@/stores/use-im-store";
import { useAuthStore } from "@/stores/use-auth-store";
import { imApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Headset, Loader2 } from "lucide-react";

interface ChatDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type FilterTab = "private" | "support";

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
  const upsertConversation = useImStore((s) => s.upsertConversation);

  const [tab, setTab] = useState<FilterTab>("private");
  // 移动端在「列表」与「聊天」两个面板间切换（桌面端两栏并存）。
  const [mobileView, setMobileView] = useState<"list" | "chat">("list");
  const [openingSupport, setOpeningSupport] = useState(false);

  // 当前登录用户的 public_id（与 MessageVO.sender.id 同口径）。
  const currentUserId = useAuthStore((s) => s.user?.id);
  const currentUserIdStr =
    currentUserId === undefined || currentUserId === null ? null : String(currentUserId);

  // 打开抽屉即拉取会话列表。
  useEffect(() => {
    if (open) void loadConversations();
  }, [open, loadConversations]);

  const filtered = useMemo(
    () =>
      conversations.filter((c) =>
        tab === "support" ? c.type === "support" : c.type !== "support",
      ),
    [conversations, tab],
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

  // 「联系客服」：打开/复用客服会话并激活。
  const handleOpenSupport = async () => {
    if (openingSupport) return;
    setOpeningSupport(true);
    try {
      const res = await imApi.openSupport();
      if (res.success && res.data) {
        upsertConversation(res.data);
        setTab("support");
        setActive(res.data.id);
        setMobileView("chat");
      }
    } finally {
      setOpeningSupport(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full gap-0 p-0 sm:max-w-md data-[side=right]:sm:max-w-3xl"
      >
        <SheetHeader className="border-b border-border p-3">
          <SheetTitle>消息</SheetTitle>
          <SheetDescription className="sr-only">私信与在线客服会话</SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1">
          {/* 左列：会话列表 */}
          <div
            className={cn(
              "flex w-full flex-col border-border md:w-72 md:shrink-0 md:border-r",
              mobileView === "chat" ? "hidden md:flex" : "flex",
            )}
          >
            {/* 私信 / 客服 Tab */}
            <div className="flex items-center gap-1 px-3 pt-3">
              <button
                type="button"
                onClick={() => setTab("private")}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                  tab === "private"
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                私信
              </button>
              <button
                type="button"
                onClick={() => setTab("support")}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                  tab === "support"
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                客服
              </button>
            </div>

            <div className="mt-2 min-h-0 flex-1 overflow-y-auto">
              <ConversationList
                conversations={filtered}
                activeId={activeId}
                loading={loadingConvs}
                isOnline={isOnline}
                onSelect={handleSelect}
              />
            </div>

            {/* 联系客服按钮 */}
            <div className="border-t border-border p-3">
              <Button
                variant="outline"
                className="w-full"
                onClick={() => void handleOpenSupport()}
                disabled={openingSupport}
              >
                {openingSupport ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Headset />
                )}
                联系客服
              </Button>
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
      </SheetContent>
    </Sheet>
  );
}
