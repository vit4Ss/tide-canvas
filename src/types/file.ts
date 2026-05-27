import type { PageQuery } from "./api";

export interface FileVO {
  id: number;
  originalName: string;
  fileUrl: string;
  fileSize: number;
  fileType: FileType;
  mimeType: string;
  storageType: StorageType;
  createTime: string;
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
