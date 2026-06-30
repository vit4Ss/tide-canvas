import { create } from "zustand";
import type { UserVO } from "@/types/user";
import { authApi } from "@/lib/api";
import { setTokens, clearTokens } from "@/lib/http";
import type { UserLoginDTO, UserRegisterDTO } from "@/types/user";

interface AuthState {
  user: UserVO | null;
  loading: boolean;
  initialized: boolean;

  login: (dto: UserLoginDTO) => Promise<void>;
  register: (dto: UserRegisterDTO) => Promise<void>;
  logout: () => Promise<void>;
  fetchUser: () => Promise<void>;
  setUser: (user: UserVO | null) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: false,
  initialized: false,

  login: async (dto) => {
    set({ loading: true });
    try {
      const result = await authApi.login(dto);
      if (result.success) {
        setTokens(result.data.accessToken, result.data.refreshToken);
        set({ user: result.data.userInfo, loading: false });
      } else {
        set({ loading: false });
        throw new Error(result.message);
      }
    } catch (error) {
      set({ loading: false });
      throw error;
    }
  },

  register: async (dto) => {
    set({ loading: true });
    try {
      const result = await authApi.register(dto);
      if (!result.success) {
        throw new Error(result.message);
      }
    } finally {
      set({ loading: false });
    }
  },

  logout: async () => {
    try {
      await authApi.logout();
    } finally {
      clearTokens();
      set({ user: null });
    }
  },

  fetchUser: async () => {
    const token = typeof window !== "undefined" ? localStorage.getItem("access_token") : null;
    if (!token) {
      set({ initialized: true });
      return;
    }
    try {
      const result = await authApi.me();
      if (result.success) {
        set({ user: result.data, initialized: true });
      } else {
        clearTokens();
        set({ user: null, initialized: true });
      }
    } catch {
      set({ initialized: true });
    }
  },

  setUser: (user) => set({ user }),
}));
