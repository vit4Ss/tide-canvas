export interface ChatUsageRow {
  id: string;
  model: string;
  modelName: string;
  keyHint: string;
  keyRevision: number;
  requestPath: string;
  stream: boolean;
  status: string;
  points: string;
  settlementMode?: string;
  deductedPoints?: string;
  pendingPointsAfter?: string;
  walletRefundedPoints?: string;
  refundedPoints?: string;
  netPoints?: string;
  reservedPoints: string;
  usageKnown: boolean;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
  firstTokenMs: number | null;
  durationMs: number | null;
  createTime: string;
  errorCode: string;
  priceMultiplier: string;
  pricing?: { inputPointsPerMillion: string; outputPointsPerMillion: string; cachedInputPointsPerMillion?: string };
  userId?: string;
  clientIP?: string;
  providerName?: string;
  billingProviderName?: string;
  endpointId?: string;
  upstreamStatus?: number;
}

export interface ChatUsagePage {
  records: ChatUsageRow[];
  total: number;
  pageNum: number;
  pages: number;
  summary: { calls: number; points: string; deductedPoints?: string; walletRefundedPoints?: string; pendingTokenPoints?: string; inputTokens: number; outputTokens: number; cachedInputTokens: number; pending: number };
}

export const usageStatuses: Record<string, { label: string; tone: string }> = {
  pending: { label: "调用中", tone: "active" },
  success: { label: "成功", tone: "success" },
  partial: { label: "部分完成", tone: "warning" },
  billing_pending: { label: "待核对", tone: "warning" },
  released: { label: "已释放", tone: "muted" },
  failed: { label: "失败", tone: "error" },
};

export function usageDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)} s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor(ms % 60000 / 1000)}s`;
}

export function usagePoints(row: Pick<ChatUsageRow, "status" | "points" | "netPoints">): string {
  if (row.status === "pending" || row.status === "billing_pending") return "待结算";
  return usageDecimal(row.netPoints ?? row.points);
}

// Monetary values arrive as decimal strings. Avoid converting them to Number:
// large balances can otherwise lose the micro-point precision used by billing.
export function usageDecimal(value: string | null | undefined): string {
  if (value == null || !/^-?\d+(?:\.\d+)?$/.test(value)) return "—";
  const [whole, fraction = ""] = value.split(".");
  const decimals = fraction.replace(/0+$/, "");
  const normalized = whole.replace(/^(-?)0+(?=\d)/, "$1");
  return `${normalized.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${decimals ? `.${decimals}` : ""}`;
}

export function usagePercent(value: number | null): string {
  if (value == null || !Number.isFinite(value) || value < 0 || value > 100) return "—";
  if (value > 0 && value < 0.1) return "<0.1";
  if (value > 99.9 && value < 100) return ">99.9";
  return value.toFixed(1);
}

export function usageProtocol(path: string): string {
  if (path.endsWith("/responses")) return "Responses";
  if (path.endsWith("/chat/completions")) return "Chat Completions";
  return "—";
}

export function usageTime(value: string): string {
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return "—";
  return time.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
}

export type UsageDatePreset = "all" | "today" | "7d" | "30d" | "custom";

// API filters use Beijing dates, independent of the viewer's local timezone.
export function usageDateRange(preset: Exclude<UsageDatePreset, "custom">, now = new Date()): { startDate: string; endDate: string } {
  if (preset === "all") return { startDate: "", endDate: "" };
  const end = new Date(now.getTime() + 8 * 3600_000);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (preset === "30d" ? 29 : preset === "7d" ? 6 : 0));
  return { startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10) };
}

export function usageCachePercent(input: number, cached: number): number | null {
  if (!Number.isFinite(input) || !Number.isFinite(cached) || input <= 0 || cached < 0 || cached > input) return null;
  return cached / input * 100;
}

export function usageDateParts(value: string): { date: string; time: string } {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return { date: "—", time: "—" };
  const shifted = new Date(parsed.getTime() + 8 * 3600_000).toISOString();
  return { date: shifted.slice(0, 10), time: shifted.slice(11, 19) };
}
