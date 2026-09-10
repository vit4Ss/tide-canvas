import type { ModelConfig } from "@/types/admin-models";

export const MAX_MODEL_PROMPT_CHARS = 1_000_000;

/** Count Unicode code points, matching Go's utf8.RuneCountInString. */
export function promptCharacterCount(prompt: string): number {
  return Array.from(prompt).length;
}

/** 0 / missing / malformed means unlimited. Values above the configuration
 * ceiling are clamped defensively; the admin API rejects them on write. */
export function modelPromptCharLimit(config: ModelConfig | null | undefined): number {
  const value = config?.maxPromptChars;
  if (typeof value !== "number") return 0;
  if (!Number.isInteger(value) || value <= 0) return 0;
  return Math.min(value, MAX_MODEL_PROMPT_CHARS);
}

export interface PromptLimitIssue {
  count: number;
  limit: number;
  message: string;
}

/** Return a user-facing issue only when the exact prompt sent to the model is
 * over the selected model's configured limit. */
export function modelPromptLimitIssue(
  prompt: string,
  config: ModelConfig | null | undefined,
): PromptLimitIssue | null {
  const limit = modelPromptCharLimit(config);
  if (!limit) return null;
  const count = promptCharacterCount(prompt);
  if (count <= limit) return null;
  return {
    count,
    limit,
    message: `提示词超过当前模型的 ${limit} 字限制（当前 ${count} 字），请精简后再生成`,
  };
}
