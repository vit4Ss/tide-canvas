// ============================================================================
// Admin · 消息管理 (Notifications) — TS shapes mirroring the Go admin handler
// in internal/handler/admin/g5_notify.go. 与用户端通知中心同表同源。
// ============================================================================

/** g5NotifyVO — 一条通知 + 接收者身份。 */
export interface AdminNotification {
  id: string;
  userId: string;
  username: string;
  email: string;
  /** system / like / comment / follow / order … */
  type: string;
  title: string;
  content: string;
  linkUrl: string;
  /** 0 未读 / 1 已读 */
  isRead: number;
  createTime: string;
  /** 截止时间（RFC3339）；空串 = 永不过期。过期后紧急横幅不再展示 */
  expireTime: string;
}

/** g5NotifySendDTO — 发送请求体。target=all 广播 / user 按邮箱定向。 */
export interface AdminNotifySendDTO {
  title: string;
  content?: string;
  linkUrl?: string;
  type?: string;
  target: "all" | "user";
  email?: string;
  /** 可选截止时间（datetime-local 值），过期后不再作为活跃通知展示 */
  expireAt?: string;
}
