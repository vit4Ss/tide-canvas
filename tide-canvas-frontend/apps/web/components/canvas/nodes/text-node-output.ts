import type { CanvasNode } from "@/stores/use-canvas-store";
import type { AiTaskVO } from "@/types/ai";

export const TEXT_NODE_HANDLER = "assistant_chat";

export interface TextNodeGenerationOutput {
  action: string;
  actionInput: string;
  supplementary: Record<string, unknown>;
  aspectRatio?: string;
  display: string;
}

function parseRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseJsonLike(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [
    fenced?.[1],
    trimmed,
    trimmed.includes("{") && trimmed.includes("}") ? trimmed.slice(trimmed.indexOf("{"), trimmed.lastIndexOf("}") + 1) : "",
  ].filter((item): item is string => Boolean(item?.trim()));

  for (const candidate of candidates) {
    try {
      return parseRecord(JSON.parse(candidate));
    } catch {
      // Try next shape.
    }
  }
  return null;
}

function textValue(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function supplementaryValue(value: unknown): Record<string, unknown> {
  const record = parseRecord(value);
  if (record) return record;
  if (typeof value === "string" && value.trim()) return parseJsonLike(value) ?? {};
  return {};
}

export function parseTaskTextResult(task: AiTaskVO) {
  const rawMeta = task.resultMeta;
  const meta = typeof rawMeta === "string" ? parseJsonLike(rawMeta) : parseRecord(rawMeta);
  if (meta) {
    const value = textValue(meta, ["answer", "content", "text", "message", "response", "output", "enhancedPrompt"]);
    if (value) return value;
  }
  return task.resultUrl?.trim() || "";
}

export function normalizeTextNodeOutput(rawText: string, fallbackPrompt: string): TextNodeGenerationOutput {
  const parsed = parseJsonLike(rawText);
  const action = textValue(parsed ?? {}, ["action", "handler"]) || "text_to_image";
  const actionInput =
    textValue(parsed ?? {}, ["action_input", "actionInput", "prompt", "input", "description", "content"]) ||
    rawText.trim() ||
    fallbackPrompt.trim();
  const supplementary = supplementaryValue(parsed?.supplementary ?? parsed?.params ?? parsed?.options);
  const aspectRatio = textValue(supplementary, ["aspect_ratio", "aspectRatio", "ratio"]);
  const normalized = {
    action,
    action_input: actionInput,
    supplementary,
  };

  return {
    action,
    actionInput,
    supplementary,
    aspectRatio: aspectRatio || undefined,
    display: JSON.stringify(normalized, null, 2),
  };
}

export function getTextNodeImageOutput(node: CanvasNode): TextNodeGenerationOutput | null {
  if (node.type !== "text") return null;
  const raw = node.textOutput?.trim() || (node.prompt?.trim().startsWith("{") ? node.prompt.trim() : "");
  if (!raw) return null;
  const output = normalizeTextNodeOutput(raw, "");
  if (output.action !== "text_to_image" || !output.actionInput.trim()) return null;
  return output;
}

export function buildTextNodeGenerationPrompt(userInput: string) {
  return [
    "你是 TideCanvas 的文字规划节点。请把用户输入整理成可被下游生成节点消费的结构化 JSON。",
    "只能返回 JSON，不要返回 Markdown、代码块、解释或多余文字。",
    "字段固定为：action、action_input、supplementary。",
    "action 根据意图选择：默认 text_to_image；若用户明确要视频用 text_to_video；明确要音乐/音频用 text_to_audio。",
    "action_input 写成可直接给生成模型使用的中文提示词，内容具体、画面/动作/材质/光线清晰。",
    "supplementary 可包含 style、aspect_ratio、quality 等补充项；没有就返回空对象。图片默认 aspect_ratio 使用 16:9。",
    "用户输入：",
    userInput.trim(),
  ].join("\n");
}
