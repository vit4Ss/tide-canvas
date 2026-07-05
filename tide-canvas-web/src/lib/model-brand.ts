/* ============================================================================
   模型品牌官方图标 — public/model-icons/*.png（源自 @lobehub/icons 静态包，
   已下载为本地资源，不依赖外链 CDN）。

   使用方式（两级）：
   1. 后台「模型管理 → 图标」可从预置品牌图标中选择（写入 config.icon 的
      /model-icons/xxx.png 路径），或继续填 emoji / 自定义图片 URL；
   2. config.icon 为空时，前端按 modelKey / 模型名自动匹配品牌图标——
      中转站同步下来的新模型无需任何配置即可显示官方 logo。
   ========================================================================== */

export interface BrandIcon {
  slug: string;
  label: string;
}

/** 预置品牌（后台图标选择器的候选清单，顺序即展示顺序）。 */
export const BRAND_ICONS: BrandIcon[] = [
  { slug: "openai", label: "OpenAI / GPT" },
  { slug: "google", label: "Google" },
  { slug: "gemini", label: "Gemini" },
  { slug: "midjourney", label: "Midjourney" },
  { slug: "flux", label: "Flux (BFL)" },
  { slug: "stability", label: "Stability" },
  { slug: "kling", label: "可灵 Kling" },
  { slug: "jimeng", label: "即梦" },
  { slug: "doubao", label: "豆包" },
  { slug: "bytedance", label: "字节 Seed" },
  { slug: "volcengine", label: "火山引擎" },
  { slug: "qwen", label: "通义千问" },
  { slug: "hunyuan", label: "混元" },
  { slug: "kolors", label: "可图 Kolors" },
  { slug: "minimax", label: "MiniMax / 海螺" },
  { slug: "vidu", label: "Vidu" },
  { slug: "runway", label: "Runway" },
  { slug: "luma", label: "Luma" },
  { slug: "pika", label: "Pika" },
  { slug: "ideogram", label: "Ideogram" },
  { slug: "recraft", label: "Recraft" },
  { slug: "deepseek", label: "DeepSeek" },
  { slug: "claude", label: "Claude" },
  { slug: "anthropic", label: "Anthropic" },
  { slug: "grok", label: "Grok" },
];

export const brandIconUrl = (slug: string): string => `/model-icons/${slug}.png`;

/* 匹配规则：对 modelKey + 名称的拼接串做正则测试，命中即用该品牌图标。
   注意顺序——更具体的词（seedream/seedance/gemini）要排在宽泛词之前。 */
const RULES: Array<[RegExp, string]> = [
  [/seedream|即梦|jimeng/i, "jimeng"],
  [/seedance|seedvr|bytedance|字节/i, "bytedance"],
  [/doubao|豆包/i, "doubao"],
  [/volcengine|火山/i, "volcengine"],
  [/gemini/i, "gemini"],
  [/nano-?banana|imagen|veo|google/i, "google"],
  [/gpt|dall[-.]?e|sora|openai|o[134][-mp]/i, "openai"],
  [/midjourney|\bmj[-_]/i, "midjourney"],
  [/flux|black-?forest/i, "flux"],
  [/sdxl|sd3|stable-|stability/i, "stability"],
  [/kling|可灵/i, "kling"],
  [/wanx?[-_ ]|qwen|通义|tongyi/i, "qwen"],
  [/hunyuan|混元/i, "hunyuan"],
  [/kolors|可图/i, "kolors"],
  [/minimax|hailuo|海螺/i, "minimax"],
  [/vidu/i, "vidu"],
  [/runway|gen-?[34]/i, "runway"],
  [/luma|dream-?machine/i, "luma"],
  [/pika/i, "pika"],
  [/ideogram/i, "ideogram"],
  [/recraft/i, "recraft"],
  [/deepseek/i, "deepseek"],
  [/claude/i, "claude"],
  [/anthropic/i, "anthropic"],
  [/grok|xai/i, "grok"],
];

/** 按 modelKey / 名称自动匹配品牌图标 URL；无法识别时返回 null（调用方回退
 *  到首字母色块）。 */
export function matchBrandIcon(...keys: Array<string | undefined>): string | null {
  const hay = keys.filter(Boolean).join(" ");
  if (!hay) return null;
  for (const [re, slug] of RULES) if (re.test(hay)) return brandIconUrl(slug);
  return null;
}
