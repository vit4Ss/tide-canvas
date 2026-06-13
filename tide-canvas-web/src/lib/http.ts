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

/**
 * 安全解析响应为统一 Result：网关 502/504、纯文本 "Internal Server Error" 等非 JSON 响应
 * 不再抛 SyntaxError，而是归一为失败 Result，由调用方按 success 分支提示。
 */
async function parseResult<T>(res: Response): Promise<Result<T>> {
  const text = await res.text();
  if (text) {
    try {
      return JSON.parse(text) as Result<T>;
    } catch {
      // 非 JSON：网关/代理错误页，落到下方兜底
    }
  }
  return {
    success: false,
    code: res.status || 500,
    message: `服务暂时不可用 (HTTP ${res.status || "?"})，请稍后重试`,
  } as Result<T>;
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
    const result = await parseResult<{ accessToken: string; refreshToken: string }>(res);
    if (result.success) {
      setTokens(result.data.accessToken, result.data.refreshToken);
      return result.data.accessToken;
    }
    // 后端明确拒绝(refresh token 失效/被吊销)才清凭据；
    // 服务不可用(5xx/非 JSON)时保留 token，等服务恢复后下次请求再续期，避免部署窗口把用户踢下线
    if (result.code === 401 || result.code === 403) {
      clearTokens();
    }
  } catch {
    // 网络异常：保留 token
  }
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
  let result: Result<T> = await parseResult<T>(res);

  if (result.code === 401 && token) {
    if (!refreshPromise) {
      refreshPromise = refreshAccessToken();
    }
    const newToken = await refreshPromise;
    refreshPromise = null;

    if (newToken) {
      headers["Authorization"] = `Bearer ${newToken}`;
      res = await fetch(url, { ...config, headers });
      result = await parseResult<T>(res);
    } else if (!getAccessToken()) {
      // 凭据已被明确清除(refresh token 失效)才跳登录；服务暂不可用时保留会话、把失败结果交给页面提示
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
  let result: Result<T> = await parseResult<T>(res);

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
      result = await parseResult<T>(res);
    } else if (!getAccessToken()) {
      if (typeof window !== "undefined") {
        window.location.href = "/login";
      }
    }
  }

  return result;
}

/** 带上传进度的文件上传（用 XHR；fetch 无法上报上传进度）。401 时刷新 token 重试一次。 */
async function uploadFileWithProgress<T>(
  path: string,
  file: File | FormData,
  onProgress?: (pct: number) => void,
): Promise<Result<T>> {
  const formData = file instanceof FormData ? file : (() => {
    const fd = new FormData();
    fd.append("file", file);
    return fd;
  })();

  const send = (token: string | null) =>
    new Promise<Result<T>>((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", buildUrl(path));
      if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      if (onProgress) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
        };
      }
      xhr.onload = () => {
        try {
          resolve(JSON.parse(xhr.responseText) as Result<T>);
        } catch {
          resolve({ success: false, code: xhr.status, message: "上传响应解析失败", data: undefined as T, timestamp: Date.now() });
        }
      };
      xhr.onerror = () => resolve({ success: false, code: 0, message: "网络错误", data: undefined as T, timestamp: Date.now() });
      xhr.send(formData);
    });

  const token = getAccessToken();
  let result = await send(token);
  if (result.code === 401 && token) {
    const newToken = await refreshAccessToken();
    if (newToken) result = await send(newToken);
  }
  return result;
}

/** 直接 PUT 一个外部 URL（如 OSS 预签名地址）并上报进度；不带应用鉴权头、不解析 JSON。 */
function putWithProgress(
  url: string,
  body: File | Blob,
  headers: Record<string, string>,
  onProgress?: (pct: number) => void,
): Promise<{ ok: boolean; status: number }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
    }
    xhr.onload = () => resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status });
    xhr.onerror = () => resolve({ ok: false, status: 0 });
    xhr.send(body);
  });
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

  uploadProgress: <T>(path: string, file: File | FormData, onProgress?: (pct: number) => void) =>
    uploadFileWithProgress<T>(path, file, onProgress),

  putProgress: (url: string, body: File | Blob, headers: Record<string, string>, onProgress?: (pct: number) => void) =>
    putWithProgress(url, body, headers, onProgress),
};

export { setTokens, clearTokens };
