import type { PageQuery } from "./api";

/** 通知类型：关注 / 评论 / 点赞 / 打赏。 */
export type NotificationType = "follow" | "comment" | "like" | "tip";

/** 通知目标类型：社区帖子 / 博客（关注类为空串）。 */
export type NotificationTargetType = "post" | "blog" | "";

/** 触发通知者的用户摘要。id 为对方 public_id。 */
export interface NotificationActorVO {
  id: string;
  username: string;
  nickname: string;
  avatar: string;
}

/** 通知列表项。 */
export interface NotificationVO {
  /** 通知自身ID（用于按条标记已读，前端仅回传不展示）。后端雪花主键，字符串传输避免精度丢失 */
  id: string;
  /** 触发者用户摘要（账号已删时各字段为空） */
  actor: NotificationActorVO;
  /** 通知类型 */
  type: NotificationType;
  /** 目标类型（post/blog，关注类为空串） */
  targetType: NotificationTargetType;
  /** 关联内容的对外 public_id（由后端反解；无目标或反解不到为空串）。
   *  前端据 targetType 跳转 /community/{targetPublicId} 或 /blogs/{targetPublicId}。 */
  targetPublicId: string;
  /** 通知摘要文案（如「评论了你的帖子」） */
  content: string;
  /** 是否已读 */
  isRead: boolean;
  /** 仅关注类(type=follow)有意义：当前用户是否已回关该 actor（用于「回关 / 已关注」持久态）。非关注类恒 false。 */
  followedByMe: boolean;
  /** 通知时间 */
  createTime: string;
}

/** 通知列表分页查询。type 为可选类型过滤（空表示全部）。 */
export interface NotificationQuery extends PageQuery {
  type?: NotificationType;
}

/** 未读数响应。 */
export interface UnreadCountVO {
  count: number;
}
