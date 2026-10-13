export const CHAT_FAMILIES = [
  { id: "all", label: "全部", icon: "" },
  { id: "gpt", label: "GPT", icon: "openai" },
  { id: "claude", label: "Claude", icon: "claude" },
  { id: "grok", label: "Grok", icon: "grok" },
  { id: "gemini", label: "Gemini", icon: "google" },
  { id: "deepseek", label: "DeepSeek", icon: "deepseek" },
  { id: "other", label: "其他", icon: "" },
] as const;

export function chatModelFamily(key: string): string {
  if (/gpt|codex|^o[134](?:-|$)/i.test(key)) return "gpt";
  if (/claude/i.test(key)) return "claude";
  if (/grok/i.test(key)) return "grok";
  if (/gemini/i.test(key)) return "gemini";
  if (/deepseek/i.test(key)) return "deepseek";
  return "other";
}

// Display conversion only. Authoritative rates and settled bills come from the server.
export function chatRateCNY(points: string | undefined): string {
  if (points === undefined || points.trim() === "") return "—";
  const amount = Number(points);
  if (!Number.isFinite(amount) || amount < 0) return "—";
  return new Intl.NumberFormat("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(amount / 10);
}
