import type { PageQuery } from "./api";

export interface FileVO {
  /** 后端公开 ID；历史生成预览在前端可使用负数临时 ID。 */
  id: string | number;
  /** 归属用户ID（团队共享时区分自己/队友的素材） */
  ownerId?: string;
  originalName: string;
  fileUrl: string;
  fileSize: number;
  fileType: FileType;
  mimeType: string;
  storageType: StorageType;
  createTime: string;
}

export interface SystemUploadVO {
  fileUrl: string;
  fileSize: number;
  fileType: FileType;
  mimeType: string;
  storageType: StorageType;
  createTime: string;
}

export interface StorageUsageVO {
  usedBytes: number;
  quotaBytes: number;
  percentage: number;
}

export interface FileQuery extends PageQuery {
  fileType?: FileType;
  keyword?: string;
}

export enum FileType {
  IMAGE = "image",
  VIDEO = "video",
  OTHER = "other",
}

export enum StorageType {
  LOCAL = "local",
  OSS = "oss",
}
