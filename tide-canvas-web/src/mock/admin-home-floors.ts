// ============================================================================
// 首页楼层 (Home floors) — floorModal 的 UI 选项集（select/chip options）。
// 楼层数据本身来自真实接口 /api/admin/home/floors（adminHomeFloorsApi），
// 旧的 HOME_FLOORS mock 列表与 HomeFloor mock 类型已删除（2026-07 审计）。
// ============================================================================

/** floorModal — 楼层类型 select options。前 7 项与公开首页的区块一一对应
 *  （type 即匹配键，见 (site)/page.tsx DEFAULT_FLOOR_TYPES）；创作者榜/自定义
 *  暂无对应区块，首页会忽略。 */
export const FLOOR_TYPE_OPTIONS = [
  "英雄区",
  "能力展示",
  "无限画布",
  "作品流",
  "模型跑马灯",
  "FAQ",
  "价格",
  "创作者榜",
  "自定义",
] as const;

/** floorModal — 内容源 select options. */
export const FLOOR_SOURCE_OPTIONS = ["实时热度", "人工精选", "最新发布", "指定合集"] as const;

/** floorModal — 布局样式 (single-select chips). */
export const FLOOR_LAYOUT_OPTIONS = ["瀑布流", "横向滑动", "Coverflow", "网格", "轮播"] as const;

/** floorModal — 可见端 (multi-select chips). */
export const FLOOR_PLATFORM_OPTIONS = ["Web", "iOS", "Android", "小程序"] as const;

/** 楼层全局配置 · 背景流光 — 默认预设 select options. */
export const FLOOR_BG_PRESETS = ["极光", "星云", "深海"] as const;

/** 楼层全局配置 · 首屏 CTA — 跳转 select options. */
export const FLOOR_CTA_TARGETS = ["创作台", "定价"] as const;
