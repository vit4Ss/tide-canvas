"use client";
import { Fragment, createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { authApi } from "@/lib/api";
import { clearTokens, getAccessToken, sessionOwner, setTokens } from "@/lib/http";
import type { LoginVO, UserVO } from "@/types/user";

const AuthContext = createContext<{ user: UserVO | null; loading: boolean; sessionVersion: () => number; refresh: () => Promise<void>; acceptLogin: (result: LoginVO) => void; login: (account: string, password: string) => Promise<void>; signup: (username: string, password: string) => Promise<void>; logout: () => Promise<void> } | null>(null);
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserVO | null>(null);
  const [loading, setLoading] = useState(true);
  const queries = useRef(0);
  const mutations = useRef(0);
  const sessionVersion = useCallback(() => mutations.current, []);
  const acceptLogin = useCallback((result: LoginVO) => {
    if (typeof result?.accessToken !== "string" || !result.accessToken || typeof result.refreshToken !== "string" || !result.refreshToken || typeof result.userInfo?.id !== "string" || !result.userInfo.id) throw new Error("The sign-in response was incomplete. Please try again.");
    queries.current += 1;
    mutations.current += 1;
    setTokens(result.accessToken, result.refreshToken); setUser(result.userInfo);
    setLoading(false);
  }, []);
  const refresh = useCallback(async () => {
    const query = ++queries.current;
    const access = getAccessToken();
    if (!access) { setUser(null); setLoading(false); return; }
    const result = await authApi.me();
    if (query !== queries.current || access !== getAccessToken()) return;
    if (result.success) setUser(result.data);
    else if (result.code === 401 || result.code === 403) setUser(null);
    setLoading(false);
  }, []);
  useEffect(() => {
    let mounted = true;
    queueMicrotask(() => { if (mounted) void refresh(); });
    const storage = (event: StorageEvent) => {
      if (event.key !== "access_token" && event.key !== null) return;
      mutations.current += 1;
      const oldOwner = sessionOwner(event.oldValue);
      if (!oldOwner || oldOwner !== sessionOwner(event.newValue)) { setUser(null); setLoading(!!getAccessToken()); }
      void refresh();
    };
    const sessionChanged = () => void refresh();
    window.addEventListener("storage", storage);
    window.addEventListener("framelyn:session", sessionChanged);
    return () => { mounted = false; queries.current += 1; mutations.current += 1; window.removeEventListener("storage", storage); window.removeEventListener("framelyn:session", sessionChanged); };
  }, [refresh]);
  const login = async (account: string, password: string) => {
    const mutation = ++mutations.current; const access = getAccessToken();
    const result = await authApi.login(account, password);
    if (mutation !== mutations.current || access !== getAccessToken()) throw new Error("Your session changed while signing in. Please try again.");
    if (!result.success) throw new Error(result.message);
    acceptLogin(result.data);
  };
  const signup = async (username: string, password: string) => {
    const mutation = ++mutations.current; const access = getAccessToken();
    const result = await authApi.registerLocal(username, password);
    if (mutation !== mutations.current || access !== getAccessToken()) throw new Error("Your session changed while signing in. Please try again.");
    if (!result.success) throw new Error(result.message);
    acceptLogin(result.data);
  };
  const logout = async () => {
    const mutation = ++mutations.current;
    try { await authApi.logout(); }
    finally { if (mutation === mutations.current) { queries.current += 1; clearTokens(); setUser(null); setLoading(false); } }
  };
  return <AuthContext.Provider value={{ user, loading, sessionVersion, refresh, acceptLogin, login, signup, logout }}>{children}</AuthContext.Provider>;
}
export function useAuth() { const auth = useContext(AuthContext); if (!auth) throw new Error("AuthProvider is required"); return auth; }

// Reset private page state, dialogs and drafts when the account changes. The
// resource hook already scopes list requests; a mounted dialog also needs scope.
export function AccountScope({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  return <Fragment key={user?.id || "signed-out"}>{children}</Fragment>;
}
