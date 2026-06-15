import { create } from "zustand";
import { adminApi } from "@/lib/api";

interface PermissionState {
  perms: Set<string>;
  loaded: boolean;
  fetchPerms: () => Promise<void>;
}

export const usePermissionStore = create<PermissionState>((set) => ({
  perms: new Set(),
  loaded: false,
  fetchPerms: async () => {
    try {
      const res = await adminApi.roles.myPermissions();
      if (res.success && res.data) set({ perms: new Set(res.data), loaded: true });
      else set({ loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
}));

/** 响应式权限判断：has("*") 或 has(code) */
export function useHasPerm() {
  const perms = usePermissionStore((s) => s.perms);
  return (code: string) => perms.has("*") || perms.has(code);
}
