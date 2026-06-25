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
  resultMeta: Record<string, unknown> | string;
  errorMsg: string;
  /** original generation request (prompt/ratio/resolution/…) for history restore */
  input: Record<string, unknown> | string;
  createTime: string;
  completeTime: string;
}

export interface AiModelVO {
  id: number;
  name: string;
  icon: string;
  modelId: string;
  type: AiModelType;
  /** 支持的生成方式(handler 列表)；空/缺省 = 不限制(支持全部) */
  supportedHandlers?: string[] | null;
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
  projectId: number;
  handlerName: string;
  operationType: string;
  model: string;
  operation: string;
  requestUrl: string;
  /** 上游请求体:后端实际发给供应商/中转站的 payload */
  requestBody: string;
  /** 用户输入参数:前端发给后端的原始参数(仅详情接口返回) */
  inputParams?: string;
  httpStatus: number;
  responseBody: string;
  upstreamTaskId: string;
  success: number;
  resultUrl: string;
  errorMsg: string;
  durationMs: number;
  /** 上游成本（USD）；中转站无此字段时为空 */
  cost?: number;
  createTime: string;
  // 关联展示字段（后端按 id 回填）
  userName?: string;
  projectName?: string;
  taskStatus?: number;
}

export interface AiGenerationLogQuery extends PageQuery {
  taskId?: number;
  userId?: number;
  projectId?: string | number;
  handlerName?: string;
  operationType?: string;
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
  AUDIO = "audio",
}
