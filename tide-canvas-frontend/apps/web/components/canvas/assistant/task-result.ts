import type { AiTaskVO } from "@/types/ai";

export function parseTaskResult(task: AiTaskVO) {
  const rawMeta = task.resultMeta;
  const meta = typeof rawMeta === "string"
    ? (() => {
        try {
          return JSON.parse(rawMeta) as Record<string, unknown>;
        } catch {
          return { text: rawMeta };
        }
      })()
    : rawMeta;

  if (meta && typeof meta === "object") {
    for (const key of ["answer", "content", "text", "message", "response", "output", "enhancedPrompt"]) {
      const value = meta[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }

  if (typeof task.resultUrl === "string" && task.resultUrl.trim()) return task.resultUrl.trim();
  return "已完成，但接口没有返回可展示的文本。";
}
