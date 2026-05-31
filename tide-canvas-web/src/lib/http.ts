import type { Result } from "@/types/api";

const SERVER_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8080";
const BASE_URL = typeof window !== "undefined" ? "" : SERVER_URL;

type QueryParams = Record<string, string | number | boolean | undefined | null>;

interface RequestOptions extends Omit<RequestInit, "body"> {
  params?: QueryParams;
  body?: unknown;
}

function buildUrl(path: string, params?: QueryParams): string {
  let url: string;
  if (BASE_URL) {
    url = new URL(path, BASE_URL).toString();
  } else {
    url = path;
  }
  if (params) {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        searchParams.set(key, String(value));
      }
    });
    const qs = searchParams.toString();
    if (qs) {
      url += (url.includes("?") ? "&" : "?") + qs;
    }
  }
  return url;
}

function getAccessToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  return localStorage.getItem("access_token");
}

function setTokens(accessToken: string, refreshToken: string) {
  localStorage.setItem("access_token", accessToken);
  localStorage.setItem("refresh_token", refreshToken);
}

function clearTokens() {
  localStorage.removeItem("access_token");
  localStorage.removeItem("refresh_token");
}

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = localStorage.getItem("refresh_token");
  if (!refreshToken) {
    return null;
  }
  try {
    const res = await fetch(buildUrl("/api/auth/refresh"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    const result: Result<{ accessToken: string; refreshToken: string }> = await res.json();
    if (result.success) {
      setTokens(result.data.accessToken, result.data.refreshToken);
      return result.data.accessToken;
    }
  } catch {
    // refresh failed
  }
  clearTokens();
  return null;
}

let refreshPromise: Promise<string | null> | null = null;

async function request<T>(path: string, options: RequestOptions = {}): Promise<Result<T>> {
  const { params, body, headers: customHeaders, ...rest } = options;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...customHeaders as Record<string, string>,
  };

  const token = getAccessToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const url = buildUrl(path, params);
  const config: RequestInit = {
    ...rest,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  };

  let res = await fetch(url, config);
  let result: Result<T> = await res.json();

  if (result.code === 401 && token) {
    if (!refreshPromise) {
      refreshPromise = refreshAccessToken();
    }
    const newToken = await refreshPromise;
    refreshPromise = null;

    if (newToken) {
      headers["Authorization"] = `Bearer ${newToken}`;
      res = await fetch(url, { ...config, headers });
      result = await res.json();
    } else {
      if (typeof window !== "undefined") {
        window.location.href = "/login";
      }
    }
  }

  return result;
}

async function uploadFile<T>(path: string, file: File | FormData): Promise<Result<T>> {
  const headers: Record<string, string> = {};
  const token = getAccessToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const formData = file instanceof FormData ? file : (() => {
    const fd = new FormData();
    fd.append("file", file);
    return fd;
  })();

  let res = await fetch(buildUrl(path), {
    method: "POST",
    headers,
    body: formData,
  });
  let result: Result<T> = await res.json();

  // 401 时尝试刷新 token 后重试
  if (result.code === 401 && token) {
    if (!refreshPromise) {
      refreshPromise = refreshAccessToken();
    }
    const newToken = await refreshPromise;
    refreshPromise = null;

    if (newToken) {
      headers["Authorization"] = `Bearer ${newToken}`;
      res = await fetch(buildUrl(path), {
        method: "POST",
        headers,
        body: formData,
      });
      result = await res.json();
    } else {
      if (typeof window !== "undefined") {
        window.location.href = "/login";
      }
    }
  }

  return result;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toParams(obj: any): QueryParams {
  return obj as QueryParams;
}

export { toParams };

export const http = {
  get: <T>(path: string, params?: QueryParams) =>
    request<T>(path, { method: "GET", params }),

  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body }),

  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body }),

  delete: <T>(path: string) =>
    request<T>(path, { method: "DELETE" }),

  upload: <T>(path: string, file: File | FormData) =>
    uploadFile<T>(path, file),
};

export { setTokens, clearTokens };
