// ============================================================================
// 首页全局配置的共享常量。原本还承载流光背景预设（FLUX_PRESETS 等），
// 该功能已按产品定稿整体移除（纯黑楼层底，不提供背景/切换器），
// 现仅保留首屏 CTA 的选项与路由解析。
// ============================================================================

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
