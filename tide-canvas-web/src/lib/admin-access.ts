import type { UserVO } from "@/types/user";

type AdminAccessUser = Pick<UserVO, "role" | "adminPerms">;

/** 超级管理员拥有全部权限；运营角色持有任一后台模块权限即可进入后台。 */
export function hasAdminAccess(user: AdminAccessUser | null | undefined): boolean {
  return !!user && (user.role === 9 || (user.adminPerms?.length ?? 0) > 0);
}
