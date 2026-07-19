"use client";

import { useEffect } from "react";
import { useAuthStore } from "@/stores/use-auth-store";

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
    isAdmin: user?.role === 9,
  };
}
