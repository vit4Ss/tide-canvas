// IM 即时通讯类型（对齐后端 internal/module/im/dto.go 与 model/im.go）。

// 会话类型
export type ConversationType = "private" | "support" | "staff";

// 客服会话状态（仅 support 用：0 待接入 / 1 进行中 / 2 已结束）
export const SupportStatus = { WAITING: 0, ACTIVE: 1, CLOSED: 2 } as const;

// 消息内容类型
export type MessageContentType = "text" | "image" | "file" | "system";

// 消息状态（对齐 model：0 正常 / 1 已撤回）
export const MessageStatus = { NORMAL: 0, RECALLED: 1 } as const;

// WebSocket 下行事件类型
export type WSEventType = "message" | "read" | "online" | "offline" | "system";

// 用户摘要（对外 public_id + 在线状态）
export interface UserBriefVO {
  id: string;
  nickname: string;
  avatar: string;
  online: boolean;
}

// 会话视图
export interface ConversationVO {
  id: string;
  type: ConversationType;
  title: string;
  status: number;
  peer?: UserBriefVO; // 1v1（私信/客服）的对端
  members?: UserBriefVO[]; // 群/多方成员
  unread: number;
  lastMessageText: string;
  lastMessageTime: string | null;
  updateTime: string;
}

// 消息视图
export interface MessageVO {
  id: string;
  conversationId: string;
  sender?: UserBriefVO;
  contentType: string;
  content: string;
  extra?: unknown;
  status: number;
  createTime: string;
}

// 用户在线状态视图
export interface UserStatusVO {
  id: string;
  online: boolean;
  lastSeen: string | null;
}

// ---- 请求 DTO ----
export interface SendMessageDTO {
  conversationId: string;
  contentType?: string;
  content: string;
  extra?: Record<string, unknown>;
}

export interface OpenStaffDTO {
  memberIds: string[];
  title?: string;
}

// ---- WebSocket 下行事件统一信封（服务端 → 客户端）----
export interface WSEvent {
  type: WSEventType;
  conversationId?: string;
  message?: MessageVO;
  userId?: string; // online/offline/read 关联用户 public_id
  data?: unknown;
}
