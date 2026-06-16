"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Avatar, AvatarBadge, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MessageBubble } from "@/components/im/message-bubble";
import { cn } from "@/lib/utils";
import type { ConversationVO, MessageVO } from "@/types/im";
import { ArrowLeft, Headset, MessageCircle, Send, User } from "lucide-react";

interface ChatWindowProps {
  conversation: ConversationVO | null;
  messages: MessageVO[];
  loading: boolean;
  /** 当前登录用户 id（public_id）；用于判断消息归属 */
  currentUserId: string | null;
  isOnline: (userId?: string) => boolean;
  onSend: (content: string) => Promise<boolean>;
  onRecall: (msgId: string) => void;
  /** 移动端「返回会话列表」（桌面端列表常驻则可不传） */
  onBack?: () => void;
}

export function ChatWindow({
  conversation,
  messages,
  loading,
  currentUserId,
  isOnline,
  onSend,
  onRecall,
  onBack,
}: ChatWindowProps) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputId = useId();

  // 新消息或切换会话后滚动到底部。
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, conversation?.id]);

  // 切换会话清空草稿。
  useEffect(() => {
    setDraft("");
  }, [conversation?.id]);

  if (!conversation) {
    return (
      <div className="hidden flex-1 flex-col items-center justify-center gap-2 text-sm text-muted-foreground md:flex">
        <MessageCircle className="size-8 opacity-40" />
        选择一个会话开始聊天
      </div>
    );
  }

  const isSupport = conversation.type === "support";
  const peerOnline = !isSupport && isOnline(conversation.peer?.id);

  const handleSend = async () => {
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    const ok = await onSend(content);
    setSending(false);
    if (ok) setDraft("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Enter 发送；Shift+Enter 交给浏览器（Input 为单行，主要拦截纯 Enter）。
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void handleSend();
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* 会话头部 */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        {onBack && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="md:hidden"
            onClick={onBack}
            aria-label="返回"
          >
            <ArrowLeft />
          </Button>
        )}
        <Avatar size="sm" className="shrink-0">
          {conversation.peer?.avatar ? (
            <AvatarImage src={conversation.peer.avatar} alt="" />
          ) : null}
          <AvatarFallback>
            {isSupport ? (
              <Headset className="size-3.5" />
            ) : conversation.peer?.nickname?.[0] ? (
              conversation.peer.nickname[0]
            ) : (
              <User className="size-3.5" />
            )}
          </AvatarFallback>
          {peerOnline && <AvatarBadge className="bg-green-500" />}
        </Avatar>
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium text-foreground">
            {conversation.title || (isSupport ? "在线客服" : "私信")}
          </span>
          {!isSupport && (
            <span
              className={cn(
                "text-[11px]",
                peerOnline ? "text-green-600 dark:text-green-500" : "text-muted-foreground",
              )}
            >
              {peerOnline ? "在线" : "离线"}
            </span>
          )}
        </div>
      </div>

      {/* 消息列表 */}
      <div ref={scrollRef} className="flex flex-1 flex-col gap-3 overflow-y-auto px-2 py-3">
        {loading && messages.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            加载中...
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            还没有消息，发送第一条吧
          </div>
        ) : (
          messages.map((msg) => {
            const isSelf =
              !!currentUserId && msg.sender?.id === currentUserId;
            return (
              <MessageBubble
                key={msg.id}
                message={msg}
                isSelf={isSelf}
                onRecall={isSelf ? onRecall : undefined}
              />
            );
          })
        )}
      </div>

      {/* 输入框 */}
      <div className="flex items-center gap-2 border-t border-border p-2.5">
        <label htmlFor={inputId} className="sr-only">
          输入消息
        </label>
        <Input
          id={inputId}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入消息，回车发送"
          autoComplete="off"
          className="h-9 flex-1"
        />
        <Button
          size="icon"
          className="size-9 shrink-0"
          onClick={() => void handleSend()}
          disabled={sending || draft.trim().length === 0}
          aria-label="发送"
        >
          <Send />
        </Button>
      </div>
    </div>
  );
}
