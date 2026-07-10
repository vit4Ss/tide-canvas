// ============================================================================
// 流光背景预设 — FluxField 着色器的调色板/动感参数（design-ref/liuguang/
// home-render.js PRESETS 原样移植）。首页背景组件（flux-bg）、导航切换器与
// 后台「首页楼层 · 楼层全局配置」共用这一份定义，保证选项永远一致。
//
// base/spread: 色相基准与随滚动扫过的幅度（弧度）；speed/scale/intensity:
// 流速/密度/亮度；sw: 切换器里的色板缩略渐变。
// ============================================================================

export interface FluxPreset {
  label: string;
  sub: string;
  base: number;
  spread: number;
  speed: number;
  scale: number;
  intensity: number;
  sw: string;
}

export const FLUX_PRESETS: Record<string, FluxPreset> = {
  aurora: {
    label: "极光",
    sub: "蓝 · 紫 · 品红",
    base: 6.15,
    spread: 1.95,
    speed: 1.0,
    scale: 1.05,
    intensity: 1.0,
    sw: "linear-gradient(120deg,#3b53d6,#9b3ad0,#d8367f)",
  },
  nebula: {
    label: "星云",
    sub: "深紫 · 洋红",
    base: 0.55,
    spread: 1.15,
    speed: 0.7,
    scale: 1.38,
    intensity: 1.05,
    sw: "linear-gradient(120deg,#7a2bd0,#b51e9c,#e0357a)",
  },
  ocean: {
    label: "深海",
    sub: "青 · 蓝绿",
    base: 4.85,
    spread: 1.25,
    speed: 0.9,
    scale: 1.12,
    intensity: 0.98,
    sw: "linear-gradient(120deg,#1c8f9c,#1aa6c0,#2f7fd0)",
  },
  ember: {
    label: "熔岩",
    sub: "玫红 · 琥珀",
    base: 1.75,
    spread: 1.1,
    speed: 1.1,
    scale: 1.0,
    intensity: 1.05,
    sw: "linear-gradient(120deg,#d8367f,#d66a3c,#d59a1f)",
  },
  verdant: {
    label: "苔原",
    sub: "黄绿 · 翠",
    base: 3.25,
    spread: 1.25,
    speed: 0.8,
    scale: 1.18,
    intensity: 1.0,
    sw: "linear-gradient(120deg,#8fa11a,#5aa83c,#1f9c7a)",
  },
  ink: {
    label: "水墨",
    sub: "极简 · 幽蓝",
    base: 6.05,
    spread: 0.45,
    speed: 0.42,
    scale: 0.92,
    intensity: 0.62,
    sw: "linear-gradient(120deg,#3a4170,#5a4a86,#6d6f9c)",
  },
};

export const FLUX_PRESET_ORDER = [
  "aurora",
  "nebula",
  "ocean",
  "ember",
  "verdant",
  "ink",
] as const;

/** localStorage 键 — 用户在导航切换器里的个人选择（design-ref 同名）。 */
export const FLUX_PRESET_STORAGE_KEY = "flux_bg_preset";

/** 首屏 CTA 跳转选项 — key 存库（home.global.ctaTarget），label 后台展示。 */
export const HOME_CTA_TARGETS = [
  { key: "studio", label: "创作台", href: "/studio" },
  { key: "pricing", label: "定价", href: "/pricing" },
] as const;

export type HomeCtaTargetKey = (typeof HOME_CTA_TARGETS)[number]["key"];

/** ctaTarget 键 → 路由；未知键回退创作台（与后端 parseHomeGlobal 兜底一致）。 */
export function ctaTargetHref(key: string): string {
  return HOME_CTA_TARGETS.find((t) => t.key === key)?.href ?? "/studio";
}
