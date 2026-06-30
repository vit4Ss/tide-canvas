"use client";

import { Avatar, AvatarBadge, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import type { ConversationVO } from "@/types/im";
import { Headset, MessageCircle, User } from "lucide-react";

interface ConversationListProps {
  conversations: ConversationVO[];
  activeId: string | null;
  loading: boolean;
  /** 判断某用户是否在线（传 store.isOnline） */
  isOnline: (userId?: string) => boolean;
  onSelect: (id: string) => void;
}

/** 列表项右侧的相对时间（今天显示 时:分，更早显示 月-日） */
function listTime(raw: string | null): string {
  if (!raw) return "";
  const m = /(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(raw);
  if (!m) return "";
  const [, , mon, day, hh, mm] = m;
  const todayPrefix = new Date().toISOString().slice(0, 10);
  const isToday = raw.slice(0, 10) === todayPrefix;
  return isToday ? `${hh}:${mm}` : `${mon}-${day}`;
}

export function ConversationList({
  conversations,
  activeId,
  loading,
  isOnline,
  onSelect,
}: ConversationListProps) {
  if (loading && conversations.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center py-10 text-sm text-muted-foreground">
        加载中...
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-10 text-center text-sm text-muted-foreground">
        <MessageCircle className="size-6 opacity-50" />
        暂无会话
      </div>
    );
  }

  return (
    <ul className="flex flex-col">
      {conversations.map((conv) => {
        const isSupport = conv.type === "support";
        const peerOnline = !isSupport && isOnline(conv.peer?.id);
        const active = conv.id === activeId;
        return (
          <li key={conv.id}>
            <button
              type="button"
              onClick={() => onSelect(conv.id)}
              className={cn(
                "flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors",
                active
                  ? "bg-muted"
                  : "hover:bg-muted/60",
              )}
            >
              <Avatar className="shrink-0">
                {conv.peer?.avatar ? (
                  <AvatarImage src={conv.peer.avatar} alt="" />
                ) : null}
                <AvatarFallback>
                  {isSupport ? (
                    <Headset className="size-4" />
                  ) : conv.peer?.nickname?.[0] ? (
                    conv.peer.nickname[0]
                  ) : (
                    <User className="size-4" />
                  )}
                </AvatarFallback>
                {peerOnline && <AvatarBadge className="bg-green-500" />}
              </Avatar>

              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-foreground">
                    {conv.title || (isSupport ? "在线客服" : "私信")}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {listTime(conv.lastMessageTime)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs text-muted-foreground">
                    {conv.lastMessageText || "暂无消息"}
                  </span>
                  {conv.unread > 0 && (
                    <span className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium text-white">
                      {conv.unread > 99 ? "99+" : conv.unread}
                    </span>
                  )}
                </div>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
