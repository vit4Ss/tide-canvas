"use client";

import { useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { MessageStatus } from "@/types/im";
import type { MessageVO } from "@/types/im";
import { RotateCcw, User } from "lucide-react";

interface MessageBubbleProps {
  message: MessageVO;
  /** 是否本人发送（决定气泡左右与可否撤回） */
  isSelf: boolean;
  /** 撤回回调（仅本人正常消息提供） */
  onRecall?: (msgId: string) => void;
}

export function MessageBubble({ message, isSelf, onRecall }: MessageBubbleProps) {
  const [hovered, setHovered] = useState(false);
  const recalled = message.status === MessageStatus.RECALLED;

  // 撤回的消息统一展示为居中灰条，不分左右。
  if (recalled) {
    return (
      <div className="flex justify-center py-1">
        <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
          消息已撤回
        </span>
      </div>
    );
  }

  const avatar = (
    <Avatar size="sm" className="mt-0.5 shrink-0">
      {message.sender?.avatar ? (
        <AvatarImage src={message.sender.avatar} alt="" />
      ) : null}
      <AvatarFallback>
        {message.sender?.nickname?.[0] ?? <User className="size-3" />}
      </AvatarFallback>
    </Avatar>
  );

  const canRecall = isSelf && !!onRecall;

  return (
    <div
      className={cn(
        "flex w-full items-start gap-2 px-1",
        isSelf ? "flex-row-reverse" : "flex-row",
      )}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {avatar}
      <div
        className={cn(
          "flex max-w-[78%] flex-col gap-0.5",
          isSelf ? "items-end" : "items-start",
        )}
      >
        <div
          className={cn(
            "rounded-2xl px-3 py-2 text-sm break-words whitespace-pre-wrap",
            isSelf
              ? "rounded-tr-sm bg-primary text-primary-foreground"
              : "rounded-tl-sm bg-muted text-foreground",
          )}
        >
          {message.content}
        </div>
        {canRecall && hovered && (
          <button
            type="button"
            onClick={() => onRecall?.(message.id)}
            className="inline-flex items-center gap-0.5 px-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <RotateCcw className="size-2.5" />
            撤回
          </button>
        )}
      </div>
    </div>
  );
}
