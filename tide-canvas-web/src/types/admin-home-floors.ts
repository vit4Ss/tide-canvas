// ============================================================================
// Admin 首页楼层 (home_floor) types — mirror the Go VO/DTO shapes in
// internal/handler/admin/g3_floors.go. These rows drive the public home layout.
//
// idgen.ID serializes as a quoted decimal string ("123"). `platforms` is always
// a non-nil array (the Go side decodes the JSON column to [] not null).
// ============================================================================

/** Admin view of a home_floor row (HomeFloorVO). */
export interface HomeFloorVO {
  id: string;
  name: string;
  subtitle: string;
  /** banner|works|models|collections... */
  type: string;
  /** manual|auto|tag:xxx */
  contentSource: string;
  count: number;
  sortOrder: number;
  enabled: boolean;
  /** grid|carousel|list */
  layout: string;
  platforms: string[];
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
  layout?: string;
  platforms?: string[];
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
  layout?: string;
  platforms?: string[];
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
