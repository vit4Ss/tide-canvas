import type { PageQuery } from "./api";

export interface AiGenerateDTO {
  handler: string;
  modelId: string;
  projectId?: number;
  input: Record<string, unknown>;
}

export interface AiTaskVO {
  id: number;
  handler: string;
  modelName: string;
  status: AiTaskStatus;
  progress: number;
  resultUrl: string;
  resultMeta: Record<string, unknown>;
  errorMsg: string;
  createTime: string;
  completeTime: string;
}

export interface AiModelVO {
  id: number;
  name: string;
  modelId: string;
  type: AiModelType;
  supportedHandlers: string[];
  config: Record<string, unknown>;
}

export interface AiHandlerVO {
  name: string;
  displayName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  isAsync: boolean;
  defaultModelId: number;
}

export interface AiTaskQuery extends PageQuery {
  handler?: string;
  status?: AiTaskStatus;
  projectId?: number;
}

export enum AiTaskStatus {
  PROCESSING = 0,
  SUCCESS = 1,
  FAILED = 2,
  CANCELLED = 3,
}

export enum AiModelType {
  IMAGE = "image",
  VIDEO = "video",
  TEXT = "text",
}
