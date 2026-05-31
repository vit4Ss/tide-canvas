import type { PageQuery } from "./api";

export interface AiGenerateDTO {
  handler: string;
  modelId: string;
  projectId?: string | number;
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
  icon: string;
  modelId: string;
  type: AiModelType;
  supportedHandlers: string[];
  config: string;
  pointCost: number;
}

export interface AiHandlerVO {
  handlerName: string;
  name: string;
  displayName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  isAsync: boolean;
  defaultModelId: number;
  pointCost: number;
}

export interface AiTaskQuery extends PageQuery {
  handler?: string;
  status?: AiTaskStatus;
  projectId?: string | number;
}

export interface AiGenerationLogVO {
  id: number;
  taskId: number;
  userId: number;
  handlerName: string;
  model: string;
  operation: string;
  requestUrl: string;
  requestBody: string;
  httpStatus: number;
  responseBody: string;
  upstreamTaskId: string;
  success: number;
  resultUrl: string;
  errorMsg: string;
  durationMs: number;
  createTime: string;
}

export interface AiGenerationLogQuery extends PageQuery {
  taskId?: number;
  projectId?: string | number;
  handlerName?: string;
  success?: number;
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
