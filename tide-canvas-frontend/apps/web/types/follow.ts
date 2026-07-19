import type { PageQuery } from "./api";

/** 关注/粉丝列表中的用户摘要。id 为对方 public_id。 */
export interface FollowUserVO {
  id: string;
  username: string;
  nickname: string;
  avatar: string;
  /** 当前登录用户是否已关注该用户 */
  following: boolean;
  /** 该用户是否关注了当前登录用户（与 following 同时为 true 即互相关注） */
  followedBy: boolean;
  /** 建立该关注关系的时间 */
  followTime: string;
}

/** 关注状态：following=我是否已关注对方；followedBy=对方是否关注了我。 */
export interface FollowStatusVO {
  following: boolean;
  followedBy: boolean;
}

/** 关注/粉丝列表分页查询。 */
export type FollowQuery = PageQuery;
