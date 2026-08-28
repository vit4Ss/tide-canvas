// ============================================================================
// Admin user-management + role (g1_users.go) wire types.
//
// Mirrors the backend VOs/DTOs in
//   tide-canvas-server/internal/handler/admin/g1_users.go
//   GET    /api/admin/users            AdminUserQuery -> PageData<AdminUserVO>
//   GET    /api/admin/users/:id        -> AdminUserVO
//   PUT    /api/admin/users/:id        AdminUserUpdateDTO -> AdminUserVO
//   POST   /api/admin/users/:id/points PointAdjustDTO -> {points}
//   GET    /api/admin/roles            -> RoleVO[]
//   POST   /api/admin/roles            RoleSaveDTO -> RoleVO
//   PUT    /api/admin/roles/:id        RoleSaveDTO -> RoleVO
//   DELETE /api/admin/roles/:id        -> void
//
// NOTE: idgen.ID marshals to a JSON STRING, so ids (id / roleId) are typed
// `string` here even though they are numeric snowflakes.
// ============================================================================

/** Admin view of a user (g1_users.go AdminUserVO). */
export interface AdminUserVO {
  id: string;
  username: string;
  email: string;
  phone: string;
  nickname: string;
  avatar: string;
  /** 0 user / 9 admin（后端实际口径；付费身份走 vipLevel，不占 role）. */
  role: number;
  roleId: string;
  vipLevel: number;
  /** 当前套餐显示名（由 vip_level 对照真实 plan 表派生；0 → 免费档）。 */
  planName: string;
  /** 0 disabled / 1 active. */
  status: number;
  apiQuota: number;
  points: number;
  isAuthor: number;
  storageQuota: number;
  storageUsed: number;
  projectCount: number;
  postCount: number;
  /** 运营备注(仅管理端可见,来源 users.remark)。 */
  remark: string;
  /** RFC3339 string, or "" for the zero value. */
  createTime: string;
  lastLoginTime: string;
}

/** Admin view of a permission role (sys_role). */
/** POST /api/admin/users/generate 的响应：password 为明文且仅此一次返回 */
export interface GeneratedUserVO {
  id: string;
  username: string;
  password: string;
}

export interface RoleVO {
  id: string;
  name: string;
  code: string;
  /** Raw JSON array string of permission keys. */
  permissions: string;
  description: string;
  status: number;
  createTime: string;
  updateTime: string;
}

/** Query params for GET /admin/users. role/status are exact-match filters. */
export interface AdminUserQuery {
  pageNum?: number;
  pageSize?: number;
  keyword?: string;
  role?: number;
  status?: number;
  /** "1" = 只看订阅用户（vipLevel >= 1，购买套餐的真实付费口径）。 */
  subscribed?: string;
}

/** Body for PUT /admin/users/:id. All fields optional (partial update). */
export interface AdminUserUpdateDTO {
  role?: number;
  status?: number;
  apiQuota?: number;
  points?: number;
  vipLevel?: number;
  roleId?: string;
  nickname?: string;
  /** 运营备注,≤255 字符;空串 = 清除。 */
  remark?: string;
}

/** Body for POST /admin/users/:id/points. amount may be negative. */
export interface PointAdjustDTO {
  amount: number;
  remark?: string;
}

/** Result of a points adjustment (the new balance). */
export interface PointAdjustResult {
  points: number;
}

/** Body for POST /admin/roles and PUT /admin/roles/:id. */
export interface RoleSaveDTO {
  name: string;
  code?: string;
  /** Raw JSON array string. */
  permissions?: string;
  description?: string;
  status?: number;
}

/* ── 用户画像（g1_user_portrait.go GET /api/admin/users/:id/portrait）────────── */

/** 通用「类型-次数-积分」聚合行；key 为后端原始键，前端负责中文标签。 */
export interface PortraitTypeStat {
  key: string;
  count: number;
  points: number;
}

export interface PortraitTxVO {
  time: string;
  changeType: string;
  amount: number;
  balance: number;
  remark: string;
}

export interface PortraitPointsVO {
  balance: number;
  totalEarned: number;
  /** 正数（消耗的绝对值）。 */
  totalSpent: number;
  earned30: number;
  spent30: number;
  refundCount: number;
  byType: PortraitTypeStat[];
  transactions: PortraitTxVO[];
}

export interface PortraitDayVO {
  date: string;
  count: number;
}

export interface PortraitLoginVO {
  time: string;
  action: string;
  channel: string;
  success: number;
  ip: string;
}

export interface PortraitActivityVO {
  /** 近 90 天，含 0 值日，升序。 */
  daily: PortraitDayVO[];
  activeDays30: number;
  loginDays30: number;
  /** 近 90 天生成时段分布（0-23 时）。 */
  hourly: number[];
  recentLogins: PortraitLoginVO[];
}

export interface PortraitGenerationVO {
  total: number;
  success: number;
  failed: number;
  cancelled: number;
  processing: number;
  total30: number;
  failed30: number;
  /** points 仅计成功任务（失败已退款）。 */
  byHandler: PortraitTypeStat[];
}

export interface PortraitModelVO {
  model: string;
  count: number;
  success: number;
  points: number;
  lastUsed: string;
}

export interface PortraitAssetsVO {
  projectCount: number;
  workCount: number;
  fileCount: number;
  storageUsed: number;
  storageQuota: number;
  skillRunCount: number;
  collectionCount: number;
}

export interface PortraitOrderVO {
  orderNo: string;
  orderType: string;
  cycle: string;
  amount: string;
  /** 0 待支付 / 1 已支付 / 2 已取消 / 3 已退款。 */
  status: number;
  time: string;
}

export interface PortraitClaimVO {
  time: string;
  batchName: string;
  codeHint: string;
  points: number;
}

export interface PortraitCommerceVO {
  paidOrderCount: number;
  paidAmount: string;
  recentOrders: PortraitOrderVO[];
  claimCount: number;
  claimPoints: number;
  recentClaims: PortraitClaimVO[];
  checkinCount: number;
  checkinPoints: number;
  checkinStreak: number;
  lastCheckin: string;
}

export interface PortraitCommunityVO {
  commentCount: number;
  likeCount: number;
  followers: number;
  following: number;
}

/** 画像页完整载荷：一次请求拿全，避免详情页十几个瀑布请求。 */
export interface UserPortraitVO {
  user: AdminUserVO;
  points: PortraitPointsVO;
  activity: PortraitActivityVO;
  generation: PortraitGenerationVO;
  models: PortraitModelVO[];
  assets: PortraitAssetsVO;
  commerce: PortraitCommerceVO;
  community: PortraitCommunityVO;
}
