export type MediaAssetType = "image" | "video" | "audio";
export type MediaAssetScope = "project" | "all";
export type MediaAssetOrder = "asc" | "desc";
export type MediaAssetSource = "generation" | "upload";

export interface MediaAssetVO {
  id: string;
  projectId: string;
  sourceType: MediaAssetSource;
  sourceId: string;
  outputIndex: number;
  mediaType: MediaAssetType;
  nodeType: string;
  name: string;
  url: string;
  thumbnailUrl: string;
  mimeType: string;
  /** 0 = processing, 1 = ready. Failed/cancelled rows are never returned. */
  status: 0 | 1;
  progress: number;
  metadata: Record<string, unknown>;
  createTime: string;
}

export interface MediaAssetQuery {
  scope: MediaAssetScope;
  projectId?: string;
  mediaType: MediaAssetType;
  orderDirection: MediaAssetOrder;
  cursor?: string;
  pageSize?: number;
  /** Internal live-task refresh; comma-separated stable source IDs. */
  sourceIds?: string;
}

export interface MediaAssetPageVO {
  records: MediaAssetVO[];
  nextCursor: string;
  counts: Record<MediaAssetType, number>;
}

export interface MediaAssetBatchDeleteVO {
  deletedIds: string[];
  blockedIds: string[];
  failedIds: string[];
}
