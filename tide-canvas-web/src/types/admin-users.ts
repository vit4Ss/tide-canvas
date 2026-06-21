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
  /** 0 user / 1 vip / 9 admin. */
  role: number;
  roleId: string;
  vipLevel: number;
  /** 0 disabled / 1 active. */
  status: number;
  apiQuota: number;
  points: number;
  isAuthor: number;
  storageQuota: number;
  storageUsed: number;
  projectCount: number;
  postCount: number;
  /** RFC3339 string, or "" for the zero value. */
  createTime: string;
  lastLoginTime: string;
}

/** Admin view of a permission role (sys_role). */
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
