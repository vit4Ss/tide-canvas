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
  summary: { calls: number; points: string; inputTokens: number; outputTokens: number; cachedInputTokens: number; pending: number };
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
  return Number(row.netPoints ?? row.points).toLocaleString("zh-CN", { maximumFractionDigits: 6 });
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
