import type { PageQuery } from "./api";
import type { UserSimpleVO } from "./user";

export interface ProjectVO {
  id: string; // 后端雪花 ID 序列化为字符串(flowingLight 全站 string ID,勿改回 number)
  /** 归属用户ID（团队共享时区分自己/队友的项目） */
  ownerId?: string;
  name: string;
  description: string;
  thumbnail: string;
  status: ProjectStatus;
  isPublic: boolean;
  urlToken: string;
  /** Whole-canvas optimistic-lock version; metadata edits do not change it. */
  revision: number;
  createTime: string;
  updateTime: string;
}

export interface ProjectDetailVO extends ProjectVO {
  canvasData: string;
  shareToken: string;
  owner: UserSimpleVO;
}

export interface CanvasDataVO {
  canvasData: string;
  revision: number;
}

export interface CanvasSaveVO {
  revision: number;
}

export interface ShareVO {
  shareToken: string;
  shareUrl: string;
}

export interface ProjectCreateDTO {
  name: string;
  description?: string;
  /** 客户端稳定请求号；响应丢失时以同一值重放，避免重复创建项目。 */
  clientRequestId?: string;
}

export interface ProjectUpdateDTO {
  name?: string;
  description?: string;
  status?: ProjectStatus;
  isPublic?: boolean;
}

export interface CanvasSaveDTO {
  canvasData: string;
  thumbnail?: string;
  expectedRevision: number;
}

export interface ProjectQuery extends PageQuery {
  keyword?: string;
  status?: ProjectStatus;
}

export enum ProjectStatus {
  DRAFT = 0,
  PUBLISHED = 1,
}
