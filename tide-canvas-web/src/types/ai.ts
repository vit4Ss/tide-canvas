import type { PageQuery } from "./api";

export interface AiGenerateDTO {
  handler: string;
  modelId: string;
  projectId?: string | number;
  /** Direct preset placement. Agent/workflow executions use SkillRun instead. */
  entryPoint?: "studio" | "chat" | "canvas" | "asset" | "api";
  /** Canvas node type or asset category used by the server-side binding check. */
  targetType?: string;
  /** Required by the wire API. Prefer aiApi.generateIdempotent at UI entry points. */
  clientRequestId: string;
  input: Record<string, unknown>;
}

export type AiGenerateInput = Omit<AiGenerateDTO, "clientRequestId"> & {
  clientRequestId?: string;
};

export interface AiTaskVO {
  id: string; // 后端雪花 ID 序列化为字符串
  handler: string;
  /** Canvas target type, e.g. image | character | scene. */
  targetType?: string;
  /** 生成所用模型的行 id(对应 AiModelVO.id;旧接口缓存可能缺省)。
      延长/翻唱须发到与原曲相同的模型卡,前端据此回选原曲模型。 */
  modelId?: string;
  modelName: string;
  status: AiTaskStatus;
  progress: number;
  /** 本次任务实际扣除的积分（服务端提交时计定，供历史/详情展示扣费） */
  pointCost: number;
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

/** 独立 AI 工具配置（公开）— 对应 Go internal/handler/ai/vo.go 的 AiToolVO
    （GET /api/ai/tools，仅返回已启用且展示独立页的工具）。 */
export interface AiToolVO {
  /** URL slug，独立页为 /tools/<key> */
  key: string;
  title: string;
  desc: string;
  /** 后端生成处理器名（handlerRegistry） */
  handler: string;
  /** 需要用户输入一句修改描述（如局部重绘） */
  needPrompt: boolean;
  /** 偏好 4K 模型（高清放大） */
  hd: boolean;
  /** 字形图标，如 ⤢ */
  icon: string;
  /** mesh 封面色相三元组；后端 CoverHues 解析失败时为 null */
  cover: [number, number, number] | null;
  placeholder: string;
  /** 额外生成参数（随请求原样下发）；空/非法 JSON 时为 null */
  extraParams: Record<string, unknown> | null;
  sortOrder: number;
}

export interface AiTaskQuery extends PageQuery {
  handler?: string;
  /** 资产页服务端媒体筛选，保证分页发生在类型过滤之后。
      "tool" = 智能工具产出(工具中心页「工具作品」区,按专属 handler 圈定)。 */
  mediaType?: "image" | "video" | "audio" | "3d" | "upscale" | "tool";
  /** Generated asset category; character/scene are image target types. */
  assetCategory?: "general" | "character" | "scene";
  /** 仅返回可进入资产库的任务（排除失败和已取消）。 */
  assetOnly?: boolean;
  status?: AiTaskStatus;
  projectId?: string | number;
  /** true = 只要不属于任何画布项目的任务（创作台/对话页发起的生成） */
  noProject?: boolean;
  /** 时间筛选(YYYY-MM-DD):create_time 当天 00:00 起 / 次日 00:00 前 */
  startDate?: string;
  endDate?: string;
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
  /** 仅管理员：非管理员调 /api/ai/logs 时后端置空（下同） */
  requestUrl: string;
  /** 仅管理员：上游请求体,后端实际发给供应商/中转站的 payload */
  requestBody: string;
  /** 用户输入参数:前端发给后端的原始参数(仅详情接口返回) */
  inputParams?: string;
  httpStatus: number;
  /** 仅管理员：上游响应原文 */
  responseBody: string;
  /** 仅管理员：供应商侧任务标识 */
  upstreamTaskId: string;
  success: number;
  resultUrl: string;
  /** 非管理员拿到的是统一话术（与任务失败同源），不是上游原文 */
  errorMsg: string;
  durationMs: number;
  /** 仅管理员：上游成本（USD）；中转站无此字段时为空 */
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
  THREE_D = "3d",
}
