// ============================================================================
// Admin · AI 聊天供应商 — 与 internal/handler/admin/g3_chat_providers.go 对应。
//
// 这套数据只服务 AI 聊天，和「模型管理 / 创作台」完全分开：主站在这里持有
// 第三方 OpenAI 兼容服务的地址与密钥，直连它们，并按用户的 Token 用量计费。
// 密钥永远不会回传前端，接口只给出 hasApiKey。
// ============================================================================

/** 每百万 Token 的积分单价；与后端 tokenbilling.Pricing 一致。 */
export interface ChatTokenPricing {
  enabled: boolean;
  inputPointsPerMillion: string;
  outputPointsPerMillion: string;
  cachedInputPointsPerMillion?: string;
  maxInputTokens?: number;
  maxOutputTokens?: number;
}

/** 一组 base_url + api_key。同一供应商可配多组，按 sortOrder 依次尝试。 */
export interface ChatEndpointVO {
  id: string;
  label: string;
  baseUrl: string;
  /** 是否已保存密钥；真实密钥不出服务端。 */
  hasApiKey: boolean;
  enabled: boolean;
  sortOrder: number;
  lastOkAt: string | null;
  lastFailedAt: string | null;
  lastFailure: string;
}

export interface ChatModelVO {
  id: string;
  modelKey: string;
  name: string;
  enabled: boolean;
  sortOrder: number;
  vision: boolean;
  /** 解析成功的单价；未配置为 null。 */
  pricing: ChatTokenPricing | null;
  /** 配置了但无法解析时的说明。 */
  priceError: string;
}

export interface ChatProviderVO {
  id: string;
  name: string;
  enabled: boolean;
  sortOrder: number;
  remark: string;
  endpoints: ChatEndpointVO[];
  models: ChatModelVO[];
}

export interface ChatProviderDTO {
  name?: string;
  enabled?: boolean;
  sortOrder?: number;
  remark?: string;
}

export interface ChatEndpointDTO {
  label?: string;
  baseUrl?: string;
  /** 留空或填掩码表示不修改已保存的密钥。 */
  apiKey?: string;
  enabled?: boolean;
  sortOrder?: number;
}

export interface ChatModelDTO {
  name?: string;
  enabled?: boolean;
  sortOrder?: number;
  vision?: boolean;
  pricing?: { tokenPricing: ChatTokenPricing } | null;
}

export interface ChatFetchResult {
  total: number;
  added: number;
}
