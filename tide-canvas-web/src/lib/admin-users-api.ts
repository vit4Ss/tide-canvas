// ============================================================================
// Admin user-management + role API client — wraps /api/admin/users and
// /api/admin/roles.
//
// Built on the shared http helper (returns Result<T>; paged = PageData<T>).
// Admin pages must call `await useAuthStore.getState().ensureSession()` before
// invoking these so the admin session (role 9) exists and AdminOnly passes.
//
// These edits hit the REAL users / sys_role / point_record tables (linkage), so
// changes are immediately visible on the user-facing app.
// ============================================================================

import { http, toParams } from "@/lib/http";
import type { PageData } from "@/types/api";
import type {
  AdminUserQuery,
  AdminUserUpdateDTO,
  AdminUserVO,
  GeneratedUserVO,
  PointAdjustDTO,
  PointAdjustResult,
  RoleSaveDTO,
  RoleVO,
  UserPortraitVO,
} from "@/types/admin-users";

export const adminUsersApi = {
  /** GET /api/admin/users -> PageData<AdminUserVO>. */
  list: (query: AdminUserQuery) =>
    http.get<PageData<AdminUserVO>>("/api/admin/users", toParams(query)),

  /** POST /api/admin/users/generate -> 随机生成本地账号（用户名+密码），
      与自助用户名注册同口径；password 明文仅此一次返回。 */
  generateUser: () => http.post<GeneratedUserVO>("/api/admin/users/generate", {}),

  /** GET /api/admin/users/:id -> AdminUserVO. */
  get: (id: string) => http.get<AdminUserVO>(`/api/admin/users/${id}`),

  /** PUT /api/admin/users/:id -> AdminUserVO (partial update). */
  update: (id: string, dto: AdminUserUpdateDTO) =>
    http.put<AdminUserVO>(`/api/admin/users/${id}`, dto),

  /** DELETE /api/admin/users/:id -> void (soft delete; frees email for re-signup). */
  delete: (id: string) => http.delete<null>(`/api/admin/users/${id}`),

  /** GET /api/admin/users/:id/portrait -> UserPortraitVO（画像页全量聚合）. */
  portrait: (id: string) => http.get<UserPortraitVO>(`/api/admin/users/${id}/portrait`),

  /** POST /api/admin/users/:id/points -> {points} (new balance). */
  adjustPoints: (id: string, dto: PointAdjustDTO) =>
    http.post<PointAdjustResult>(`/api/admin/users/${id}/points`, dto),

  /** GET /api/admin/roles -> RoleVO[]. */
  listRoles: () => http.get<RoleVO[]>("/api/admin/roles"),

  /** POST /api/admin/roles -> RoleVO. */
  createRole: (dto: RoleSaveDTO) => http.post<RoleVO>("/api/admin/roles", dto),

  /** PUT /api/admin/roles/:id -> RoleVO. */
  updateRole: (id: string, dto: RoleSaveDTO) =>
    http.put<RoleVO>(`/api/admin/roles/${id}`, dto),

  /** DELETE /api/admin/roles/:id -> void. */
  deleteRole: (id: string) => http.delete<null>(`/api/admin/roles/${id}`),
};
