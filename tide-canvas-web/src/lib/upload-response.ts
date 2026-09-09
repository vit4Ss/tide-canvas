import type { Result } from "@/types/api";

function statusMessage(status: number): string {
  switch (status) {
    case 0:
      return "上传网络连接失败，请检查网络后重试";
    case 401:
      return "登录状态已失效，请重新登录后上传";
    case 403:
      return "当前账号没有上传权限";
    case 404:
      return "上传接口不存在，请检查前端与后端版本是否一致";
    case 408:
    case 504:
      return `上传请求超时（HTTP ${status}），请稍后重试`;
    case 413:
      return "上传文件超过网关允许大小（HTTP 413），请缩小文件后重试";
    case 429:
      return "上传请求过于频繁，请稍后重试";
    case 502:
    case 503:
      return `上传服务暂时不可用（HTTP ${status}），请稍后重试`;
    default:
      if (status >= 500) return `上传服务异常（HTTP ${status}），请稍后重试`;
      if (status >= 200 && status < 300) {
        return `上传服务返回了无法识别的响应（HTTP ${status}），请联系管理员检查反向代理`;
      }
      return `上传失败（HTTP ${status || "?"}）`;
  }
}

/** XHR 上传需要自行解析响应。后端正常返回统一 Result；Nginx/网关的
 * HTML、空响应和常见 error/message JSON 都在这里收敛成可直接展示的错误。 */
export function parseUploadResponse<T>(status: number, responseText: string): Result<T> {
  const text = responseText.trim();
  if (text) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const record = parsed as Record<string, unknown>;
        if (typeof record.success === "boolean") return record as unknown as Result<T>;
        const upstreamMessage = typeof record.message === "string"
          ? record.message.trim()
          : typeof record.error === "string"
            ? record.error.trim()
            : "";
        if (upstreamMessage) {
          return { success: false, code: status, message: upstreamMessage, timestamp: Date.now() } as Result<T>;
        }
      }
    } catch {
      // 网关 HTML/纯文本不得原样展示，避免把代理页面或内部信息带进 UI。
    }
  }
  return {
    success: false,
    code: status,
    message: statusMessage(status),
    timestamp: Date.now(),
  } as Result<T>;
}
