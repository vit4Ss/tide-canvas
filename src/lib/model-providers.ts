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
  { id: "black-forest-labs", name: "Black Forest Labs", icon: "flux", monochrome: true, match: /flux|black[-_ ]?forest/i },
  { id: "kling", name: "Kling", icon: "kling", monochrome: false, match: /kling/i },
  { id: "runway", name: "Runway", icon: "runway", monochrome: true, match: /runway|\bgen[-_ ]?[34]\b/i },
  { id: "luma", name: "Luma", icon: "luma", monochrome: false, match: /luma|dream[-_ ]?machine/i },
  { id: "ideogram", name: "Ideogram", icon: "ideogram", monochrome: true, match: /ideogram/i },
  { id: "pika", name: "Pika", icon: "pika", monochrome: true, match: /\bpika/i },
  { id: "stability", name: "Stability AI", icon: "stability", monochrome: false, match: /stability|stable[-_ ]?diffusion|\bsdxl\b|\bsd3\b/i },
] as const;

export function modelProvider(model: { type?: unknown; modelKey?: string; name?: string }) {
  if (!isMediaModel(model)) return undefined;
  return MODEL_PROVIDERS.find((provider) => provider.match.test(`${model.modelKey || ""} ${model.name || ""}`));
}
