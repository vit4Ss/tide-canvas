import type { PageQuery } from "./api";

export interface FileVO {
  id: string; // 后端雪花 ID 序列化为字符串
  /** 归属用户ID（团队共享时区分自己/队友的素材） */
  ownerId?: string;
  originalName: string;
  fileUrl: string;
  fileSize: number;
  fileType: FileType;
  /** 资产业务分类；不改变图片/视频等物理媒体类型。 */
  category: FileCategory;
  mimeType: string;
  storageType: StorageType;
  createTime: string;
}

export interface FileQuery extends PageQuery {
  fileType?: FileType;
  category?: FileCategory;
  keyword?: string;
  /** 时间筛选(YYYY-MM-DD):create_time 当天 00:00 起 / 次日 00:00 前 */
  startDate?: string;
  endDate?: string;
}

export enum FileType {
  IMAGE = "image",
  VIDEO = "video",
  OTHER = "other",
}

export enum FileCategory {
  GENERAL = "general",
  CHARACTER = "character",
  SCENE = "scene",
}

export enum StorageType {
  LOCAL = "local",
  OSS = "oss",
}
