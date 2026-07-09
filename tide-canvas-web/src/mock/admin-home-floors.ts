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

/** floorModal — 内容源选项（多选、可组合）。key 存库（home_floor.content_source，
 *  逗号分隔），label 展示。仅「吃作品」的楼层出现该控件（见 WORKS_FLOOR_TYPES）；
 *  后端按选择顺序取审核通过作品、去重合并（内容源解析见 content/service.go）。 */
export const FLOOR_SOURCE_OPTIONS = [
  { key: "hot", label: "实时热度" },
  { key: "latest", label: "最新发布" },
] as const;

/** 需要「内容源」的楼层类型 —— 目前只有作品流吃动态社区作品；其余楼层为静态或
 *  有自己的固有来源（模型跑马灯=模型），编辑弹窗里不显示内容源。 */
export const WORKS_FLOOR_TYPES = ["作品流"] as const;

/** 楼层全局配置 · 背景流光 — 默认预设 select options. */
export const FLOOR_BG_PRESETS = ["极光", "星云", "深海"] as const;

/** 楼层全局配置 · 首屏 CTA — 跳转 select options. */
export const FLOOR_CTA_TARGETS = ["创作台", "定价"] as const;
