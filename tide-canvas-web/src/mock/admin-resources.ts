// ============================================================================
// 资源管理 (Resources) mock data — ported 1:1 from design-ref/liuguang/admin.js.
//
// admin.js V.res() renders a 5-row 资源管理 table. name/type/size are explicit;
// refs/updatedAt/status are derived positionally from the row index.
//
//   refs:      (900 - i*120) + 'k'
//   updatedAt: '12 分钟前'  (constant in the prototype)
//   status:    i===4 ? '待清理'(amber) : '健康'(green)
// ============================================================================

import type { PillTone } from "@/mock/admin";

/** A resource row in the 资源管理 table. */
export interface AdminResource {
  /** 资源 — bucket / object name. */
  name: string;
  /** 类型 — 存储桶 | CDN | 字体库 | 模型权重 | 临时. */
  type: string;
  /** 大小 — formatted, e.g. "24.1 TB". */
  size: string;
  /** 引用 — formatted, e.g. "900k". */
  refs: string;
  /** 更新时间 — relative, e.g. "12 分钟前". */
  updatedAt: string;
  /** 状态 label. */
  status: string;
  /** 状态 tone (admin.js: 待清理→amber, 健康→green). */
  statusTone: PillTone;
  /** Whether this resource is a clearable cache/temp bucket (待清理). */
  clearable: boolean;
}

// [name, type, size] tuples from admin.js V.res().
const RAW: [string, string, string][] = [
  ["works-images", "存储桶", "24.1 TB"],
  ["video-cache", "CDN", "8.6 TB"],
  ["fonts", "字体库", "1.2 GB"],
  ["lora-weights", "模型权重", "4.3 TB"],
  ["temp-uploads", "临时", "38 GB"],
];

export const RESOURCES: AdminResource[] = RAW.map(([name, type, size], i) => {
  const clearable = i === 4;
  return {
    name,
    type,
    size,
    refs: `${900 - i * 120}k`,
    updatedAt: "12 分钟前",
    status: clearable ? "待清理" : "健康",
    statusTone: clearable ? "amber" : "green",
    clearable,
  };
});

/** KPI tiles above the table — ported from admin.js kpis([...]). */
export const RESOURCE_KPIS = [
  { k: "存储占用", v: "38.2 TB", d: "+1.1 TB", dir: "down" as const },
  { k: "CDN 月流量", v: "920 TB", d: "+6%", dir: "up" as const },
  { k: "素材库", v: "12,408", d: "", dir: "up" as const },
  { k: "回收待清", v: "38 GB", d: "", dir: "down" as const },
];

/** Filter chips above the table — note these are the 类型 buckets in admin.js. */
export const RESOURCE_FILTERS = ["存储桶", "素材库", "字体", "缓存"] as const;
