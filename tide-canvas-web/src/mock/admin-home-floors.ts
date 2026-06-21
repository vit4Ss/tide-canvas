// ============================================================================
// 首页楼层 (Home floors) mock — ported 1:1 from design-ref/liuguang/admin.js
// V.floor() + floorModal(). 100% mock.
//
// Sections:
//  - HOME_FLOORS        → the draggable .floor list (名称 / 副标题 / 启用)
//  - FLOOR_GLOBAL_*     → 楼层全局配置 cfg-cards (背景流光 / 首屏 CTA)
//  - FLOOR_*            → option lists feeding the floorModal selects/chips.
// ============================================================================

/** A 首页楼层 row (one draggable .floor card). */
export interface HomeFloor {
  /** 楼层名称 (data-floor key). */
  name: string;
  /** 副标题 / meta line. */
  subtitle: string;
  /** 是否启用. */
  enabled: boolean;
  /** 楼层类型 (for the edit modal). */
  type: string;
  /** 内容源 (for the edit modal). */
  contentSource: string;
  /** 展示数量. */
  count: number;
  /** 布局样式 (single-select chip). */
  layout: string;
  /** 可见端 (multi-select chips). */
  platforms: string[];
}

/** 首页楼层管理 — 拖拽排序，控制首页各楼层的展示与内容源. */
export const HOME_FLOORS: HomeFloor[] = [
  {
    name: "英雄区 Hero",
    subtitle: "主视觉 + Prompt 输入",
    enabled: true,
    type: "英雄区",
    contentSource: "人工精选",
    count: 1,
    layout: "轮播",
    platforms: ["Web", "iOS", "Android", "小程序"],
  },
  {
    name: "能力展示",
    subtitle: "4 张能力卡",
    enabled: true,
    type: "能力展示",
    contentSource: "人工精选",
    count: 4,
    layout: "网格",
    platforms: ["Web", "iOS", "Android", "小程序"],
  },
  {
    name: "无限画布",
    subtitle: "节点画布演示",
    enabled: true,
    type: "自定义",
    contentSource: "人工精选",
    count: 1,
    layout: "横向滑动",
    platforms: ["Web", "iOS", "Android"],
  },
  {
    name: "作品广场 Coverflow",
    subtitle: "实时作品流",
    enabled: true,
    type: "作品流",
    contentSource: "实时热度",
    count: 10,
    layout: "Coverflow",
    platforms: ["Web", "iOS", "Android", "小程序"],
  },
  {
    name: "创作者榜",
    subtitle: "Top 10 创作者",
    enabled: false,
    type: "创作者榜",
    contentSource: "实时热度",
    count: 10,
    layout: "瀑布流",
    platforms: ["Web", "iOS", "Android"],
  },
  {
    name: "价格方案",
    subtitle: "三档套餐",
    enabled: true,
    type: "价格",
    contentSource: "人工精选",
    count: 3,
    layout: "网格",
    platforms: ["Web", "iOS", "Android", "小程序"],
  },
  {
    name: "FAQ",
    subtitle: "常见问题",
    enabled: true,
    type: "FAQ",
    contentSource: "人工精选",
    count: 8,
    layout: "网格",
    platforms: ["Web", "iOS", "Android", "小程序"],
  },
];

/** floorModal — 楼层类型 select options. */
export const FLOOR_TYPE_OPTIONS = [
  "英雄区",
  "能力展示",
  "作品流",
  "创作者榜",
  "价格",
  "FAQ",
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
