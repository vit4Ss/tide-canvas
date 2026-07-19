import type { PageQuery } from "./api";
import type { UserSimpleVO } from "./user";

export interface ProjectVO {
  id: number;
  /** 归属用户ID（团队共享时区分自己/队友的项目） */
  ownerId?: string;
  name: string;
  description: string;
  thumbnail: string;
  status: ProjectStatus;
  isPublic: boolean;
  urlToken: string;
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
  updateTime?: string;
}

export interface ShareVO {
  shareToken: string;
  shareUrl: string;
}

export interface ProjectCreateDTO {
  name: string;
  description?: string;
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
  expectedUpdateTime?: string;
}

export interface ProjectQuery extends PageQuery {
  keyword?: string;
  status?: ProjectStatus;
}

export enum ProjectStatus {
  DRAFT = 0,
  PUBLISHED = 1,
}
