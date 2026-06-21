import type { PageQuery } from "./api";

/**
 * Market domain types — mirror the backend VOs in
 * tide-canvas-server/internal/handler/market/vo.go. All id fields are string
 * (idgen.ID serializes to a JSON string), all keys are camelCase.
 */

/** One entry of GET /api/market/categories. The slug doubles as the base-family
 *  filter key passed back to GET /api/market/models?base=<slug>. */
export interface ModelCategoryVO {
  id: string;
  name: string;
  slug: string;
  icon: string;
  sortOrder: number;
}

/** Embedded author view inside MarketModelVO. */
export interface AuthorVO {
  id: string;
  name: string;
}

/** List/detail view of a marketplace model. Several fields (nameCn/nameEn, base,
 *  type, ver, badge) are derived server-side from the stored name/tags columns. */
export interface MarketModelVO {
  id: string;
  type: string;
  nameCn: string;
  nameEn: string;
  base: string;
  author: AuthorVO;
  runs: number;
  likes: number;
  ver: string;
  /** Plain display tags (pseudo-tags base/type/ver/badge already lifted out). */
  tags: string[];
  /** Mixed-case badge string ("Hot" | "New" | "Fast" | "Pro" | ...) or "". */
  badge: string;
  /** Cover image URL; may be empty → caller falls back to a mesh gradient. */
  cover: string;
}

/** Query for GET /api/market/models (MarketModelQuery + PageQuery). */
export interface MarketModelQuery extends PageQuery {
  /** Base family filter; "全部"/"all" is treated as no filter server-side. */
  base?: string;
  /** Model type tag filter (e.g. 文生图 / 图生图 / 文生视频). */
  type?: string;
  /** Sort key. */
  sort?: "runs" | "name" | "new";
  /** Fuzzy match over name / description / tags. */
  keyword?: string;
}
