import { create } from "zustand";
import type { UserVO } from "@/types/user";
import { authApi } from "@/lib/api";
import { setTokens, clearTokens } from "@/lib/http";
import type { UserLoginDTO, UserRegisterDTO } from "@/types/user";

/** 去重：并发调用 ensureSession 只发一次 fetchUser 请求。 */
let ensureSessionPromise: Promise<boolean> | null = null;

interface AuthState {
  user: UserVO | null;
  loading: boolean;
  initialized: boolean;

  login: (dto: UserLoginDTO) => Promise<void>;
  loginCode: (dto: { email: string; code: string }) => Promise<void>;
  register: (dto: UserRegisterDTO) => Promise<void>;
  logout: () => Promise<void>;
  fetchUser: () => Promise<void>;
  setUser: (user: UserVO | null) => void;
  /**
   * 确保存在有效会话：
   *  - 有 token：确保拉过用户信息（fetchUser），返回 true。
   *  - 无 token：跳转到 /login?redirect=<当前路径>，返回 false（调用方据此中止后续鉴权请求）。
   * 不再静默登录默认账号——改由真正的登录页门禁。
   */
  ensureSession: () => Promise<boolean>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  loading: false,
  initialized: false,

  login: async (dto) => {
    set({ loading: true });
    try {
      const result = await authApi.login(dto);
      if (result.success) {
        setTokens(result.data.accessToken, result.data.refreshToken);
        set({ user: result.data.userInfo, loading: false, initialized: true });
      } else {
        set({ loading: false });
        throw new Error(result.message);
      }
    } catch (error) {
      set({ loading: false });
      throw error;
    }
  },

  loginCode: async (dto) => {
    set({ loading: true });
    try {
      const result = await authApi.loginCode(dto);
      if (result.success) {
        setTokens(result.data.accessToken, result.data.refreshToken);
        set({ user: result.data.userInfo, loading: false, initialized: true });
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

  ensureSession: async () => {
    if (typeof window === "undefined") return false;
    // 有 token：确保拉过用户信息即可（并发去重）。
    if (localStorage.getItem("access_token")) {
      if (!get().initialized) {
        if (!ensureSessionPromise) {
          ensureSessionPromise = (async () => {
            try {
              await get().fetchUser();
            } finally {
              ensureSessionPromise = null;
            }
            return true;
          })();
        }
        await ensureSessionPromise;
      }
      return true;
    }
    // 无 token：跳转到登录页，带上当前路径用于登录后回跳。
    const here = window.location.pathname + window.location.search + window.location.hash;
    // 已在登录页时不再重复跳转，避免回环。
    if (window.location.pathname !== "/login") {
      window.location.href = `/login?redirect=${encodeURIComponent(here)}`;
    }
    return false;
  },
}));
