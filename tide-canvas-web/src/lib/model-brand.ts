/* ============================================================================
   模型品牌官方图标 — public/model-icons/*.png（源自 @lobehub/icons 静态包，
   已下载为本地资源，不依赖外链 CDN）。

   使用方式（两级）：
   1. 后台「模型管理 → 图标」可从预置品牌图标中选择（写入 config.icon 的
      /model-icons/xxx.png 路径），或继续填 emoji / 自定义图片 URL；
   2. config.icon 为空时，前端按 modelKey / 模型名自动匹配品牌图标——
      中转站同步下来的新模型无需任何配置即可显示官方 logo。
   ========================================================================== */

import type { CSSProperties } from "react";
import { grayscaleSwatch } from "./swatch";

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

/* ── 共享 swatch 解析（chat / 创作台的模型选择器共用一份，防止漂移） ─────── */

/** true when an icon value is an image URL (vs. an emoji / short glyph). */
export function isIconUrl(icon: string): boolean {
  return /^(https?:)?\/\//.test(icon) || icon.startsWith("/");
}

/** 首字母字形（A-Z / CJK），无则 "A"。 */
export function modelInitial(name: string): string {
  return name.replace(/[^A-Za-z一-龥]/g, "").charAt(0) || "A";
}

/** 品牌 logo 的白底衬垫：logo 是黑图形配透明底，需要白底 + contain 留白，
 *  不能 cover 裁切、更不能直接铺在暗色芯片上。 */
const brandPlate = (url: string): CSSProperties => ({
  background: `#fff center/66% no-repeat url("${url}")`,
  boxShadow: "inset 0 0 0 1px rgba(22,28,45,.1)",
});

/** swatch 样式 + 字形，三级优先：
 *  1. 后台配置的 icon（图片 URL → cover；emoji → 浅灰渐变底上的字形）
 *  2. 品牌官方 logo（白底衬垫，按 modelKey/名称自动匹配）
 *  3. 首字母 + 浅灰哈希渐变兜底 */
export function resolveModelSwatch(m?: {
  name: string;
  modelKey?: string;
  icon?: string | null;
}): { style: CSSProperties; glyph: string } {
  const name = m?.name || "";
  const icon = m?.icon || "";
  if (icon && isIconUrl(icon)) {
    return {
      style: icon.startsWith("/model-icons/")
        ? brandPlate(icon)
        : { background: `center/cover no-repeat url("${icon}")` },
      glyph: "",
    };
  }
  if (icon) return { style: { background: grayscaleSwatch(name, "light") }, glyph: icon };
  const brand = matchBrandIcon(m?.modelKey, name);
  if (brand) return { style: brandPlate(brand), glyph: "" };
  return { style: { background: grayscaleSwatch(name, "light") }, glyph: modelInitial(name) };
}
