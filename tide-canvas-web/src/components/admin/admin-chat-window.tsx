"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Avatar, Badge, Button, Empty, Input, Spin, Tag, Tooltip, theme } from "antd";
import { SendOutlined, RollbackOutlined } from "@ant-design/icons";
import { useImStore } from "@/stores/use-im-store";
import { useAuthStore } from "@/stores/use-auth-store";
import { formatDate } from "@/lib/utils";
import { MessageStatus, SupportStatus } from "@/types/im";
import type { ConversationVO, MessageVO, UserBriefVO } from "@/types/im";

/** 取会话标题（私信/客服优先对端昵称，群聊用 title 或成员名拼接） */
export function convTitle(c: ConversationVO): string {
  if (c.title) return c.title;
  if (c.peer?.nickname) return c.peer.nickname;
  if (c.members && c.members.length > 0) return c.members.map((m) => m.nickname).join("、");
  return "会话";
}

/** 客服会话状态标签 */
function supportStatusTag(status: number) {
  if (status === SupportStatus.WAITING) return <Tag color="gold">待接入</Tag>;
  if (status === SupportStatus.ACTIVE) return <Tag color="green">进行中</Tag>;
  if (status === SupportStatus.CLOSED) return <Tag color="default">已结束</Tag>;
  return null;
}

function MessageRow({
  msg,
  isSelf,
  onRecall,
}: {
  msg: MessageVO;
  isSelf: boolean;
  onRecall: (msgId: string) => void;
}) {
  const { token } = theme.useToken();
  const recalled = msg.status === MessageStatus.RECALLED;

  if (recalled) {
    return (
      <div style={{ textAlign: "center", margin: "6px 0" }}>
        <span style={{ fontSize: 12, color: token.colorTextQuaternary }}>
          {isSelf ? "你" : msg.sender?.nickname || "对方"}撤回了一条消息
        </span>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: isSelf ? "row-reverse" : "row",
        alignItems: "flex-start",
        gap: 8,
        margin: "10px 0",
      }}
    >
      <Avatar size={32} src={msg.sender?.avatar || undefined} style={{ flexShrink: 0, background: token.colorPrimary }}>
        {(msg.sender?.nickname || "?").charAt(0).toUpperCase()}
      </Avatar>
      <div style={{ maxWidth: "70%", display: "flex", flexDirection: "column", alignItems: isSelf ? "flex-end" : "flex-start" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2, flexDirection: isSelf ? "row-reverse" : "row" }}>
          <span style={{ fontSize: 12, color: token.colorTextTertiary }}>{msg.sender?.nickname || "未知"}</span>
          <span style={{ fontSize: 11, color: token.colorTextQuaternary }}>{formatDate(msg.createTime)}</span>
          {isSelf && (
            <Tooltip title="撤回">
              <RollbackOutlined
                onClick={() => onRecall(msg.id)}
                style={{ fontSize: 12, color: token.colorTextQuaternary, cursor: "pointer" }}
              />
            </Tooltip>
          )}
        </div>
        <div
          style={{
            padding: "8px 12px",
            borderRadius: 10,
            fontSize: 14,
            lineHeight: 1.5,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            background: isSelf ? token.colorPrimary : token.colorFillSecondary,
            color: isSelf ? "#fff" : token.colorText,
          }}
        >
          {msg.contentType === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={msg.content} alt="image" style={{ maxWidth: 220, borderRadius: 6, display: "block" }} />
          ) : (
            msg.content
          )}
        </div>
      </div>
    </div>
  );
}

export function AdminChatWindow({ conversation }: { conversation: ConversationVO | null }) {
  const { token } = theme.useToken();
  const currentUser = useAuthStore((s) => s.user);
  // user.id 运行时为 public_id（后端 UserVO.id=public_id），与 MessageVO.sender.id 同口径
  const selfId = currentUser ? String(currentUser.id) : "";

  const messagesMap = useImStore((s) => s.messages);
  const loadingMsgs = useImStore((s) => s.loadingMsgs);
  const onlineIds = useImStore((s) => s.onlineIds);
  const send = useImStore((s) => s.send);
  const recall = useImStore((s) => s.recall);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const convId = conversation?.id ?? null;
  const messages = useMemo(() => (convId ? messagesMap[convId] || [] : []), [messagesMap, convId]);

  // 新消息 / 切换会话后滚动到底部
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, convId]);

  // 对端在线状态：private/support 看 peer；staff 群看成员任一在线
  const isPeerOnline = (() => {
    if (!conversation) return false;
    if (conversation.peer) return onlineIds.has(conversation.peer.id);
    const members: UserBriefVO[] = conversation.members || [];
    return members.some((m) => m.id !== selfId && onlineIds.has(m.id));
  })();

  const isSupportClosed = conversation?.type === "support" && conversation.status === SupportStatus.CLOSED;
  const canSend = !!conversation && !isSupportClosed;

  const handleSend = async () => {
    const text = draft.trim();
    if (!text || !convId || sending) return;
    setSending(true);
    const ok = await send(convId, text);
    setSending(false);
    if (ok) setDraft("");
  };

  if (!conversation) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: token.colorTextTertiary,
        }}
      >
        <Empty description="选择左侧会话开始聊天" />
      </div>
    );
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* 顶部会话信息 */}
      <div
        style={{
          flexShrink: 0,
          padding: "10px 16px",
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        {conversation.peer || (conversation.members && conversation.members.length === 1) ? (
          <Badge dot color={isPeerOnline ? "green" : token.colorTextQuaternary} offset={[-2, 28]}>
            <Avatar size={32} src={conversation.peer?.avatar || undefined} style={{ background: token.colorPrimary }}>
              {convTitle(conversation).charAt(0).toUpperCase()}
            </Avatar>
          </Badge>
        ) : (
          <Avatar size={32} style={{ background: token.colorPrimary }}>
            {convTitle(conversation).charAt(0).toUpperCase()}
          </Avatar>
        )}
        <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: token.colorText, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {convTitle(conversation)}
            </span>
            {conversation.type === "support" && supportStatusTag(conversation.status)}
            {conversation.type === "staff" && <Tag color="blue">同事</Tag>}
          </div>
          <span style={{ fontSize: 12, color: token.colorTextTertiary }}>
            {conversation.peer || (conversation.members && conversation.members.length === 1)
              ? isPeerOnline
                ? "在线"
                : "离线"
              : `${conversation.members?.length ?? 0} 人会话`}
          </span>
        </div>
      </div>

      {/* 消息列表 */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "8px 16px" }}>
        {loadingMsgs && messages.length === 0 ? (
          <div style={{ display: "flex", justifyContent: "center", paddingTop: 60 }}>
            <Spin />
          </div>
        ) : messages.length === 0 ? (
          <div style={{ textAlign: "center", paddingTop: 60, color: token.colorTextTertiary, fontSize: 13 }}>
            暂无消息，发条消息开始对话吧
          </div>
        ) : (
          messages.map((m) => (
            <MessageRow key={m.id} msg={m} isSelf={!!selfId && m.sender?.id === selfId} onRecall={(id) => convId && recall(convId, id)} />
          ))
        )}
      </div>

      {/* 发送框 */}
      <div style={{ flexShrink: 0, borderTop: `1px solid ${token.colorBorderSecondary}`, padding: 12 }}>
        {isSupportClosed && (
          <div style={{ fontSize: 12, color: token.colorTextTertiary, marginBottom: 8 }}>该客服会话已结束，无法继续发送消息。</div>
        )}
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <Input.TextArea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={canSend ? "输入消息，Enter 发送 / Shift+Enter 换行" : "无法发送"}
            disabled={!canSend}
            autoSize={{ minRows: 1, maxRows: 4 }}
            onPressEnter={(e) => {
              if (!e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
          />
          <Button type="primary" icon={<SendOutlined />} loading={sending} disabled={!canSend || !draft.trim()} onClick={handleSend}>
            发送
          </Button>
        </div>
      </div>
    </div>
  );
}
