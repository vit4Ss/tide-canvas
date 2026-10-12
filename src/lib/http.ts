import type { Result } from "@/types/api";
import { englishError } from "./english.ts";

type Params = Record<string, string | number | boolean | undefined | null>;
let refreshPending: Promise<string | null> | null = null;
export function setTokens(access: string, refresh: string) {
  const previousAccess = localStorage.getItem("access_token");
  const previousRefresh = localStorage.getItem("refresh_token");
  try {
    localStorage.setItem("refresh_token", refresh);
    localStorage.setItem("access_token", access);
  } catch {
    try {
      if (previousRefresh === null) localStorage.removeItem("refresh_token"); else localStorage.setItem("refresh_token", previousRefresh);
      if (previousAccess === null) localStorage.removeItem("access_token"); else localStorage.setItem("access_token", previousAccess);
    } catch {
      try { localStorage.removeItem("access_token"); localStorage.removeItem("refresh_token"); } catch { /* Site storage is inaccessible. */ }
      window.dispatchEvent(new Event("framelyn:session"));
    }
    throw new Error("Your browser could not save your sign-in. Enable site storage and try again.");
  }
  window.dispatchEvent(new Event("framelyn:session"));
}
export function clearTokens() {
  localStorage.removeItem("access_token");
  localStorage.removeItem("refresh_token");
  window.dispatchEvent(new Event("framelyn:session"));
}
export function getAccessToken() { try { return typeof window === "undefined" ? null : localStorage.getItem("access_token"); } catch { return null; } }

// This is only a hint for retaining same-account drafts during token refresh.
// Server verification and /auth/me remain the authority for authentication.
export function sessionOwner(access: string | null): string | null {
  try {
    const payload = access?.split(".")[1]; if (!payload) return null;
    const claims = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof claims.uid === "string" && claims.uid ? claims.uid : typeof claims.sub === "string" && claims.sub ? claims.sub : null;
  } catch { return null; }
}
function url(path: string, params?: Params) {
  const query = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => { if (value !== undefined && value !== null) query.set(key, String(value)); });
  return path + (query.size ? `${path.includes("?") ? "&" : "?"}${query}` : "");
}
async function parse<T>(response: Response): Promise<Result<T>> {
  try {
    const body = await response.json();
    if (typeof body.success === "boolean") return { ...body, message: body.success ? body.message || "" : englishError(body.message) };
  } catch { /* Proxies may return an HTML error page. */ }
  return { success: false, code: response.status >= 400 ? response.status : 502, message: `The service returned HTTP ${response.status}. Please try again.`, data: null as T, timestamp: Date.now() };
}
async function refresh(): Promise<string | null> {
  if (refreshPending) return refreshPending;
  refreshPending = (async () => {
    const saved = localStorage.getItem("refresh_token");
    if (!saved) { clearTokens(); return null; }
    try {
      const result = await parse<{ accessToken: string; refreshToken: string }>(await fetch("/api/auth/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refreshToken: saved }), signal: AbortSignal.timeout(15_000) }));
      if (localStorage.getItem("refresh_token") !== saved) return null;
      if (result.success && result.data?.accessToken) {
        setTokens(result.data.accessToken, result.data.refreshToken);
        return result.data.accessToken;
      }
      if (result.code === 401 || result.code === 403) clearTokens();
    } catch { /* Retain tokens across a temporary outage. */ }
    return null;
  })().finally(() => { refreshPending = null; });
  return refreshPending;
}
async function request<T>(path: string, body?: unknown, options: RequestInit = {}, params?: Params): Promise<Result<T>> {
  const headers = new Headers(options.headers);
  if (!(body instanceof FormData)) headers.set("Content-Type", "application/json");
  const saved = getAccessToken();
  if (saved && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${saved}`);
  const pinned = headers.get("Authorization");
  if (pinned && pinned !== (saved ? `Bearer ${saved}` : null)) return { success: false, code: 409, message: "Your session changed before this request. Please try again.", data: null as T, timestamp: Date.now() };
  const init: RequestInit = { ...options, headers, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body), cache: "no-store" };
  try {
    let result = await parse<T>(await fetch(url(path, params), init));
    if (result.code === 401 && saved && saved === getAccessToken() && !options.signal?.aborted) {
      const next = await refresh();
      if (next && next === getAccessToken() && !options.signal?.aborted) {
        headers.set("Authorization", `Bearer ${next}`);
        result = await parse<T>(await fetch(url(path, params), init));
      }
    }
    return result;
  } catch {
    return { success: false, code: 0, message: options.signal?.aborted ? "The connection was interrupted. Your task may still be processing." : "Unable to connect. Check your connection and try again.", data: null as T, timestamp: Date.now() };
  }
}
export const http = {
  get: <T>(path: string, params?: Params, options?: RequestInit) => request<T>(path, undefined, { ...options, method: "GET" }, params),
  post: <T>(path: string, body?: unknown, options?: RequestInit) => request<T>(path, body, { ...options, method: "POST" }),
  put: <T>(path: string, body?: unknown, options?: RequestInit) => request<T>(path, body, { ...options, method: "PUT" }),
  delete: <T>(path: string, options?: RequestInit) => request<T>(path, undefined, { ...options, method: "DELETE" }),
};
