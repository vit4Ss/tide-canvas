// ============================================================================
// 生成记录 —— 与后端 admin/g7_generations.go 的 VO 一一对应。
// 数据源是 model_call_log(同日志管理的模型日志),但按生成记录形态组装:
// 请求体解析出 prompt/生成参数/输入素材,响应体(或关联任务)解析出生成结果。
// ============================================================================

/** 输入素材 / 生成结果的一项。 */
export interface GenAsset {
  url?: string;
  name?: string;
  kind: "image" | "video" | "audio" | "file" | string;
}

/** 生成参数网格的一项(已从请求体拍平成标量)。 */
export interface GenParam {
  key: string;
  value: string;
}

/** 列表行。 */
export interface GenerationRowVO {
  id: string;
  userId: string;
  username: string;
  scene: string;
  /** 上游模型 key(gpt-5.6-sol;技术口径,详情/调试用) */
  model: string;
  /** 目录显示名(GPT-5.6 Sol);查不到为空 → 展示回退 model */
  modelName: string;
  prompt: string;
  success: number;
  httpStatus: number;
  errorMsg: string;
  /** null = 无计费记录(文本场景/未关联到任务) */
  pointCost: number | null;
  durationMs: number;
  upstreamTaskId: string;
  createTime: string;
}

/** 详情(结构化解析 + 原始报文)。 */
export interface GenerationDetailVO extends GenerationRowVO {
  startTime: string;
  endpoint: string;
  /** 上游成本(供应商侧,非平台积分) */
  cost: string;
  params: GenParam[];
  inputs: GenAsset[];
  results: GenAsset[];
  /** 文本场景:助手回复 */
  reply: string;
  requestBody: string;
  responseBody: string;
}

/** 列表查询参数。 */
export interface GenerationQuery {
  pageNum?: number;
  pageSize?: number;
  keyword?: string;
  scene?: string;
  success?: string;
  userId?: string;
  startDate?: string;
  endDate?: string;
}
