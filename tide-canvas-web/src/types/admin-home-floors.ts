// ============================================================================
// Admin 首页楼层 (home_floor) types — mirror the Go VO/DTO shapes in
// internal/handler/admin/g3_floors.go. These rows drive the public home layout.
//
// idgen.ID serializes as a quoted decimal string ("123").
// ============================================================================

/** Admin view of a home_floor row (HomeFloorVO). */
export interface HomeFloorVO {
  id: string;
  name: string;
  /** Admin-facing description (shown in the floor list); not sent to the site. */
  subtitle: string;
  /** 英雄区|能力展示|无限画布|作品流|模型跑马灯|FAQ|价格 — the machine key the
   *  public homepage matches its sections on. */
  type: string;
  /** 作品流 content sources: comma-separated keys "hot"/"latest" (可组合). Empty
   *  for non-works floors. */
  contentSource: string;
  count: number;
  sortOrder: number;
  enabled: boolean;
  createTime: string;
  updateTime: string;
}

/** Create a home floor (HomeFloorCreateDTO). */
export interface HomeFloorCreateDTO {
  name: string;
  subtitle?: string;
  type: string;
  contentSource?: string;
  count?: number;
  sortOrder?: number;
  enabled?: boolean;
}

/** Partial update; omitted fields are left unchanged (HomeFloorUpdateDTO). */
export interface HomeFloorUpdateDTO {
  name?: string;
  subtitle?: string;
  type?: string;
  contentSource?: string;
  count?: number;
  sortOrder?: number;
  enabled?: boolean;
}

/** Reorder payload (HomeFloorOrderDTO). Either ids (ordered) or explicit pairs. */
export interface HomeFloorOrderItem {
  id: string;
  sortOrder: number;
}

export interface HomeFloorOrderDTO {
  /** Ordered list of floor ids; index 0 gets the lowest sortOrder. */
  ids?: string[];
  /** Explicit {id, sortOrder} pairs. */
  orders?: HomeFloorOrderItem[];
}
