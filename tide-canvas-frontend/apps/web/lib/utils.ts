import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** 统一时间格式：YYYY-MM-DD HH:MM:SS（24 小时制，精确到秒） */
export function formatDate(dateStr: string): string {
  if (!dateStr) return "";
  // 后端 LocalDateTime 形如 2026-06-14T13:45:30 或 2026-06-14 13:45:30：
  // 直接按字符串规整，避免 new Date 的时区偏移与 Safari 对空格分隔的解析兼容问题。
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/.exec(dateStr);
  if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} `
    + `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/** 同 formatDate（完整到秒）。保留函数名以兼容历史调用。 */
export function formatDateTime(dateStr: string): string {
  return formatDate(dateStr);
}

/** 旧版项目自动命名为「未命名项目 2026/5/29」，列表展示时去掉自动追加的日期后缀 */
export function displayProjectName(name: string): string {
  return name.replace(/^(未命名项目)\s+\d{4}\/\d{1,2}\/\d{1,2}\s*$/, "$1");
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}
