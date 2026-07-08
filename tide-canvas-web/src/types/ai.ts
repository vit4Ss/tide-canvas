import type { PageQuery } from "./api";

export interface AiGenerateDTO {
  handler: string;
  modelId: string;
  projectId?: string | number;
  input: Record<string, unknown>;
}

export interface AiTaskVO {
  id: string; // 后端雪花 ID 序列化为字符串
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
  id: string;
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
  // 后端 rawJSONOrString：合法 JSON 时为对象，列存非法 JSON 时会退化成字符串
  // （与 AiTaskVO.resultMeta/input 同处理），消费前需判类型。
  inputSchema: Record<string, unknown> | string;
  isAsync: boolean;
  defaultModelId: string;
  pointCost: number;
}

export interface AiTaskQuery extends PageQuery {
  handler?: string;
  status?: AiTaskStatus;
  projectId?: string | number;
}

export interface AiGenerationLogVO {
  id: string;
  taskId: string;
  userId: string;
  projectId: string;
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
  // 雪花 ID（> 2^53），必须以字符串传递，用 Number() 会丢精度、匹配到错误/空结果。
  taskId?: string | number;
  userId?: string | number;
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
