// ============================================================================
// 发现管理 (Discover) mock data — ported 1:1 from design-ref/liuguang/admin.js.
//
// admin.js V.discover() renders a 5-row 发现页配置 table whose cover / position /
// sortStrategy / validity / status are all derived positionally from the row
// index. We freeze those derived values into typed rows here.
//
//   cover:        mesh(80+i*40, 140+i*20, 60+i*50)   (raw seeds → mesh() at render)
//   position:     ['首屏轮播','中部推荐','侧栏'][i % 3]
//   sortStrategy: ['热度','最新','人工'][i % 3]   (tag tone: blue)
//   validity:     '~ 02-2' + i
//   status:       sw(i !== 4)  →  enabled unless last row
// ============================================================================

/** A discover slot / banner row. */
export interface DiscoverSlot {
  /** 标题. */
  title: string;
  /** Raw mesh seeds for the cover tile — derive CSS via mesh(...cover). */
  cover: [number, number, number];
  /** 位置 — 首屏轮播 | 中部推荐 | 侧栏. */
  position: string;
  /** 排序策略 — 热度 | 最新 | 人工 (rendered as a blue tag). */
  sortStrategy: string;
  /** 有效期 — e.g. "~ 02-23". */
  validity: string;
  /** 状态 — on/off switch (上线/下线). */
  enabled: boolean;
}

const SLOT_TITLES = ["本周精选", "新模型尝鲜", "国风专题", "年度盘点", "视频专区"];
const POSITIONS = ["首屏轮播", "中部推荐", "侧栏"];
const STRATEGIES = ["热度", "最新", "人工"];

export const DISCOVER_SLOTS: DiscoverSlot[] = SLOT_TITLES.map((title, i) => ({
  title,
  cover: [80 + i * 40, 140 + i * 20, 60 + i * 50],
  position: POSITIONS[i % 3],
  sortStrategy: STRATEGIES[i % 3],
  validity: `~ 02-2${i}`,
  enabled: i !== 4,
}));

/** KPI tiles above the table — ported from admin.js kpis([...]). */
export const DISCOVER_KPIS = [
  { k: "推荐位", v: "24", d: "", dir: "up" as const },
  { k: "横幅 Banner", v: "6", d: "", dir: "up" as const },
  { k: "专题", v: "18", d: "+2", dir: "up" as const },
  { k: "今日曝光", v: "3.2M", d: "+4%", dir: "up" as const },
];

/** Filter chips above the table. */
export const DISCOVER_FILTERS = ["推荐位", "横幅", "专题"] as const;

/* ──────────────────────────────────────────────────────────────────────────
   Edit-modal option sets (the prototype's "+ 新增推荐位" / 编辑 modal).
   admin.js wired the buttons but did not author a discover-specific modal body;
   we compose a faithful one from the same field vocabulary the table uses.
   ──────────────────────────────────────────────────────────────────────── */

export const DISCOVER_POSITIONS = POSITIONS;
export const DISCOVER_STRATEGIES = STRATEGIES;
export const DISCOVER_SLOT_TYPES = ["推荐位", "横幅", "专题"] as const;
