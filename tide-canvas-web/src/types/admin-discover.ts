// TS shapes for the admin 发现 (discover slots) endpoints.
// Mirrors g2_discover.go: DiscoverSlotVO / DiscoverSlotUpsertDTO over model.Banner
// (the SAME sys_banner table the public home banners read).
// Banner.Status: 0 隐藏 / 1 显示. ids are quoted-string idgen.IDs.

export const SLOT_STATUS_HIDDEN = 0;
export const SLOT_STATUS_SHOWN = 1;

export interface DiscoverSlotVO {
  id: string;
  title: string;
  imageUrl: string;
  linkUrl: string;
  position: string;
  sortOrder: number;
  /** 0 隐藏 / 1 显示 */
  status: number;
  statusText: string;
  createTime: string;
  updateTime: string;
}

/** Optional filter for GET /admin/discover/slots (DiscoverSlotQuery). */
export interface DiscoverSlotQuery {
  position?: string;
  /** 0/1 — a real filter value (0 is meaningful). */
  status?: number;
}

/**
 * Body for POST/PUT /admin/discover/slots[/:id] (DiscoverSlotUpsertDTO).
 * imageUrl is required; the numeric fields map to nullable pointers, so omit a
 * field to leave it unchanged on update.
 */
export interface DiscoverSlotUpsertDTO {
  title?: string;
  imageUrl: string;
  linkUrl?: string;
  position?: string;
  sortOrder?: number;
  status?: number;
}
