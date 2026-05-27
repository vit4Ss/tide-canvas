import type { PageQuery } from "./api";
import type { UserSimpleVO } from "./user";

export interface ProjectVO {
  id: number;
  name: string;
  description: string;
  thumbnail: string;
  status: ProjectStatus;
  isPublic: boolean;
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
}

export interface ProjectQuery extends PageQuery {
  keyword?: string;
  status?: ProjectStatus;
}

export enum ProjectStatus {
  DRAFT = 0,
  PUBLISHED = 1,
}
