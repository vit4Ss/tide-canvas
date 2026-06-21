// ============================================================================
// Admin email (g5_email.go) wire types.
//
// Mirrors the backend VO/DTO in
//   tide-canvas-server/internal/handler/admin/g5_email.go
//   GET    /api/admin/email/templates        -> PageData<EmailTemplateVO>
//   POST   /api/admin/email/templates        EmailTemplateDTO -> EmailTemplateVO
//   PUT    /api/admin/email/templates/:id     EmailTemplateDTO -> EmailTemplateVO
//   DELETE /api/admin/email/templates/:id     -> void
//   GET    /api/admin/email/api-keys         -> PageData<ApiKeyVO>
//   POST   /api/admin/email/api-keys         ApiKeyDTO -> ApiKeyVO
//   PUT    /api/admin/email/api-keys/:id       ApiKeyDTO -> ApiKeyVO
//   DELETE /api/admin/email/api-keys/:id       -> void
//
// IDs serialize as quoted decimal STRINGS (idgen.ID). enabled is a real bool.
// ApiKey.expiry is an RFC3339 string ("" when none); keyValue is auto-minted
// server-side when blank on create.
// ============================================================================

/** An email template (model.EmailTemplate). */
export interface EmailTemplateVO {
  id: string;
  name: string;
  /** html | text … (defaults to "html" on create). */
  type: string;
  /** 触发场景, e.g. "用户注册". */
  scene: string;
  /** 可用变量, e.g. "{code} {name}". */
  variables: string;
  subject: string;
  body: string;
  enabled: boolean;
}

/** Create/update body for an email template. */
export interface EmailTemplateDTO {
  name: string;
  type?: string;
  scene?: string;
  variables?: string;
  subject?: string;
  body?: string;
  enabled?: boolean;
}

/** A developer API key (model.ApiKey). */
export interface ApiKeyVO {
  id: string;
  name: string;
  /** 权限范围, e.g. "全部" | "生成" | "只读" | "导出". */
  scope: string;
  /** The key value (server-minted when blank on create). */
  keyValue: string;
  /** Calls allowed per day (0 = unlimited). */
  dailyLimit: number;
  /** RFC3339, "" when no expiry. */
  expiry: string;
  enabled: boolean;
}

/** Create/update body for an API key. */
export interface ApiKeyDTO {
  name: string;
  scope?: string;
  /** Optional on create; auto-minted when blank. */
  keyValue?: string;
  dailyLimit?: number;
  /** RFC3339 / "YYYY-MM-DD HH:MM:SS" / "YYYY-MM-DD". */
  expiry?: string;
  enabled?: boolean;
}

/** Shared list query (g5PageQuery) for templates / api-keys. */
export interface EmailQuery {
  pageNum?: number;
  pageSize?: number;
  keyword?: string;
  /** templates only. */
  scene?: string;
  type?: string;
}
