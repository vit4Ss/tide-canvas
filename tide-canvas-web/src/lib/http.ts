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

/** 网络层失败（离线/DNS/连接重置等，此时 fetch 直接 reject 而非返回响应）归一为统一的
    失败 Result，使所有调用方都走 success:false 分支，无需各自 try/catch，也不会抛出未处理的
    Promise rejection 或让上层卡在 loading 态。 */
function networkFailResult<T>(): Result<T> {
  return {
    success: false,
    code: 0,
    message: "网络连接失败，请检查网络后重试",
  } as Result<T>;
}

/** fetch + parseResult，且【绝不抛出】：网络异常与响应体读取异常都归一为失败 Result。 */
async function fetchResult<T>(input: string, init: RequestInit): Promise<Result<T>> {
  try {
    const res = await fetch(input, init);
    return await parseResult<T>(res);
  } catch {
    return networkFailResult<T>();
  }
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

/** 单飞刷新:并发 401(含普通请求、fetch 上传、XHR 进度上传)只发起一次 refresh,
    所有调用方共享同一 Promise;由发起者在自己的 finally 里重置,避免后到的等待者
    把下一轮刚创建的 Promise 置空,从而并发跑出两次 refresh(第二次用已消费的
    refresh token → 401 → 误清凭据把用户踢下线)。 */
function refreshTokenOnce(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = refreshAccessToken().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

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

  let result = await fetchResult<T>(url, config);

  if (result.code === 401 && token) {
    const newToken = await refreshTokenOnce();

    if (newToken) {
      headers["Authorization"] = `Bearer ${newToken}`;
      result = await fetchResult<T>(url, { ...config, headers });
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

  let result = await fetchResult<T>(buildUrl(path), {
    method: "POST",
    headers,
    body: formData,
  });

  // 401 时尝试刷新 token 后重试
  if (result.code === 401 && token) {
    const newToken = await refreshTokenOnce();

    if (newToken) {
      headers["Authorization"] = `Bearer ${newToken}`;
      result = await fetchResult<T>(buildUrl(path), {
        method: "POST",
        headers,
        body: formData,
      });
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
    // Route through the shared single-flight so a progress upload racing another
    // 401 doesn't fire a second concurrent refresh with an already-rotated token.
    const newToken = await refreshTokenOnce();
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

// fetchWithAuth —— 画布子系统用的低层带鉴权 fetch(返回原始 Response,由调用方自解析)。
// 相对路径经 buildUrl 指向 API 源(与 http.* 一致),已注入 Bearer,凭据随行。
function authHeaders(init?: HeadersInit): Headers {
  const headers = new Headers(init);
  const token = getAccessToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return headers;
}

async function fetchWithAuth(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const target = typeof input === "string" ? buildUrl(input) : input;
  return fetch(target, {
    ...init,
    headers: authHeaders(init.headers),
    credentials: init.credentials ?? "include",
  });
}

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

export { setTokens, clearTokens, fetchWithAuth };
