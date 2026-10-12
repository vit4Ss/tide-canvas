import { isMediaModel } from "./model-visibility";

// Match media model families, not relay vendors or text-only products.
export const MODEL_PROVIDERS = [
  { id: "openai", name: "OpenAI", icon: "openai", monochrome: true, match: /gpt[-_ ]?image|dall[-_. ]?e|sora|openai/i },
  { id: "google", name: "Google", icon: "google", monochrome: false, match: /nano[-_ ]?banana|gemini|imagen|veo|google/i },
  { id: "bytedance", name: "ByteDance", icon: "bytedance", monochrome: false, match: /seedream|seedance|seedvr|jimeng|bytedance/i },
  { id: "alibaba", name: "Alibaba / Qwen", icon: "qwen", monochrome: false, match: /qwen|wan\d|wan[-_ ]|wanx/i },
  { id: "minimax", name: "MiniMax", icon: "minimax", monochrome: false, match: /minimax|hailuo/i },
  { id: "midjourney", name: "Midjourney", icon: "midjourney", monochrome: true, match: /midjourney/i },
  { id: "suno", name: "Suno", icon: "suno", monochrome: false, match: /suno/i },
  { id: "xai", name: "xAI", icon: "grok", monochrome: true, match: /grok|\bxai\b/i },
  { id: "tencent", name: "Tencent / Hunyuan", icon: "hunyuan", monochrome: false, match: /hunyuan|hy[-_ ]?3d/i },
] as const;

export function modelProvider(model: { type?: unknown; modelKey?: string; name?: string }) {
  if (!isMediaModel(model)) return undefined;
  return MODEL_PROVIDERS.find((provider) => provider.match.test(`${model.modelKey || ""} ${model.name || ""}`));
}
