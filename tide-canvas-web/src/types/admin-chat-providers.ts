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
  /** 解析成功的单价；未配置为 null。这是运营填的原价。 */
  pricing: ChatTokenPricing | null;
  /** 原价 × 供应商倍率，即网关实际按此结算的单价；倍率为 1 时与 pricing 相同。 */
  effectivePricing: ChatTokenPricing | null;
  /** 配置了但无法解析时的说明。 */
  priceError: string;
  /** 同一 modelKey 在多家供应商间的顺序，越小越先被调用；「设为首选」会重排为 0,1,2…。 */
  priority: number;
  /** 路由会选这一行来服务这个 modelKey。 */
  preferred: boolean;
  /** 还有几家供应商能提供同一个模型（已开放、已定价、供应商启用）；为 0 时不显示首选控件。 */
  rivals: number;
}

export interface ChatProviderVO {
  id: string;
  name: string;
  enabled: boolean;
  sortOrder: number;
  remark: string;
  endpoints: ChatEndpointVO[];
  models: ChatModelVO[];
  /** 新拉取的模型和尚未定价的模型自动使用的单价；未设置为 null。 */
  defaultPricing: ChatTokenPricing | null;
  /** 十进制字符串，如 "0.7"；空串表示按原价（1）。 */
  priceMultiplier: string;
  /** 系统内置默认单价：行和供应商都没有单价时按它出售，页面用作占位提示。 */
  fallbackPricing: ChatTokenPricing;
}

export interface ChatProviderDTO {
  name?: string;
  enabled?: boolean;
  sortOrder?: number;
  remark?: string;
  /** null 清除默认单价。 */
  defaultPricing?: { tokenPricing: ChatTokenPricing } | null;
  /** 空串恢复为按原价。 */
  priceMultiplier?: string;
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
  /** 本次为原本未定价的模型补上默认单价并开放的数量。 */
  filled?: number;
}
