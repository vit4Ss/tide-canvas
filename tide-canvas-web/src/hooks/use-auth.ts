"use client";

import { useEffect } from "react";
import { useAuthStore } from "@/stores/use-auth-store";
import { hasAdminAccess } from "@/lib/admin-access";

export function useAuth() {
  const { user, loading, initialized, fetchUser } = useAuthStore();

  useEffect(() => {
    if (!initialized) {
      fetchUser();
    }
  }, [initialized, fetchUser]);

  return {
    user,
    loading,
    initialized,
    isLoggedIn: !!user,
    /** 仅 role=9；与持有细分后台权限的运营角色区分。 */
    isAdmin: user?.role === 9,
    /** 超管或持有任一 admin.* 模块权限的运营角色。 */
    hasAdminAccess: hasAdminAccess(user),
  };
}
