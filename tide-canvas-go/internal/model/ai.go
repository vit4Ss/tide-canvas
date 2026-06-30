package model

import (
	"time"

	"github.com/shopspring/decimal"
	"gorm.io/datatypes"
)

// AiProvider AI供应商表 ai_provider（含加密密钥，管理端专用）。
type AiProvider struct {
	SoftDeleteModel
	Name         string         `json:"name" gorm:"column:name"`
	ProviderType string         `json:"providerType" gorm:"column:provider_type"`
	APIKey       string         `json:"-" gorm:"column:api_key"`
	BackupKeys   datatypes.JSON `json:"-" gorm:"column:backup_keys"`
	BaseURL      string         `json:"baseUrl" gorm:"column:base_url"`
	Status       int            `json:"status" gorm:"column:status"`
	Priority     int            `json:"priority" gorm:"column:priority"`
	RateLimit    int            `json:"rateLimit" gorm:"column:rate_limit"`
	Config       datatypes.JSON `json:"config" gorm:"column:config"`
}

// TableName 表名。
func (AiProvider) TableName() string { return "ai_provider" }

// AiModel AI模型表 ai_model。对外以 public_id 引用。
type AiModel struct {
	PublicModel
	ProviderID        int64           `json:"-" gorm:"column:provider_id"`
	Name              string          `json:"name" gorm:"column:name"`
	Icon              string          `json:"icon" gorm:"column:icon"`
	ModelID           string          `json:"modelId" gorm:"column:model_id"`
	Type              string          `json:"type" gorm:"column:type"`
	SupportedHandlers datatypes.JSON  `json:"supportedHandlers" gorm:"column:supported_handlers"`
	Config            datatypes.JSON  `json:"config" gorm:"column:config"`
	CostPerCall       decimal.Decimal `json:"-" gorm:"column:cost_per_call"`
	PointCost         decimal.Decimal `json:"pointCost" gorm:"column:point_cost"`
	Status            int             `json:"status" gorm:"column:status"`
}

// TableName 表名。
func (AiModel) TableName() string { return "ai_model" }

// AiHandlerConfig AI Handler配置表 ai_handler_config。
type AiHandlerConfig struct {
	SoftDeleteModel
	HandlerName    string          `json:"handlerName" gorm:"column:handler_name"`
	DisplayName    string          `json:"displayName" gorm:"column:display_name"`
	Description    string          `json:"description" gorm:"column:description"`
	InputSchema    datatypes.JSON  `json:"inputSchema" gorm:"column:input_schema"`
	DefaultModelID *int64          `json:"-" gorm:"column:default_model_id"`
	AsyncFlag      int             `json:"asyncFlag" gorm:"column:async_flag"`
	Status         int             `json:"status" gorm:"column:status"`
	SortOrder      int             `json:"sortOrder" gorm:"column:sort_order"`
	PointCost      decimal.Decimal `json:"pointCost" gorm:"column:point_cost"`
}

// TableName 表名。
func (AiHandlerConfig) TableName() string { return "ai_handler_config" }

// AiPromptPolicy stores local prompt review rules for the generation preflight step.
type AiPromptPolicy struct {
	SoftDeleteModel
	Name        string `json:"name" gorm:"column:name"`
	Category    string `json:"category" gorm:"column:category"`
	MatchType   string `json:"matchType" gorm:"column:match_type"`
	Pattern     string `json:"pattern" gorm:"column:pattern"`
	Action      string `json:"action" gorm:"column:action"`
	Severity    int    `json:"severity" gorm:"column:severity"`
	Description string `json:"description" gorm:"column:description"`
	Status      int    `json:"status" gorm:"column:status"`
}

func (AiPromptPolicy) TableName() string { return "ai_prompt_policy" }

// AiPromptReviewLog records the preflight decision before an AI task is created.
type AiPromptReviewLog struct {
	BaseModel
	UserID          *int64         `json:"userId" gorm:"column:user_id"`
	HandlerName     string         `json:"handlerName" gorm:"column:handler_name"`
	LogicalModel    string         `json:"logicalModel" gorm:"column:logical_model"`
	Prompt          string         `json:"prompt" gorm:"column:prompt"`
	Action          string         `json:"action" gorm:"column:action"`
	Category        string         `json:"category" gorm:"column:category"`
	Reason          string         `json:"reason" gorm:"column:reason"`
	MatchedPolicyID *int64         `json:"matchedPolicyId" gorm:"column:matched_policy_id"`
	ComplexityLevel string         `json:"complexityLevel" gorm:"column:complexity_level"`
	ComplexityScore int            `json:"complexityScore" gorm:"column:complexity_score"`
	Tags            datatypes.JSON `json:"tags" gorm:"column:tags"`
	InputParams     datatypes.JSON `json:"inputParams" gorm:"column:input_params"`
}

func (AiPromptReviewLog) TableName() string { return "ai_prompt_review_log" }

// AiUpstreamModel is the physical provider model used by the route resolver.
type AiUpstreamModel struct {
	SoftDeleteModel
	ProviderID   int64           `json:"providerId" gorm:"column:provider_id"`
	Name         string          `json:"name" gorm:"column:name"`
	ModelID      string          `json:"modelId" gorm:"column:model_id"`
	Type         string          `json:"type" gorm:"column:type"`
	Capabilities datatypes.JSON  `json:"capabilities" gorm:"column:capabilities"`
	Config       datatypes.JSON  `json:"config" gorm:"column:config"`
	CostPerCall  decimal.Decimal `json:"costPerCall" gorm:"column:cost_per_call"`
	TimeoutMs    int             `json:"timeoutMs" gorm:"column:timeout_ms"`
	Priority     int             `json:"priority" gorm:"column:priority"`
	Status       int             `json:"status" gorm:"column:status"`
}

func (AiUpstreamModel) TableName() string { return "ai_upstream_model" }

// AiModelRoute maps a logical user-facing model to one or more upstream models.
type AiModelRoute struct {
	SoftDeleteModel
	LogicalModelID  int64          `json:"logicalModelId" gorm:"column:logical_model_id"`
	UpstreamModelID int64          `json:"upstreamModelId" gorm:"column:upstream_model_id"`
	HandlerName     string         `json:"handlerName" gorm:"column:handler_name"`
	RouteStrategy   string         `json:"routeStrategy" gorm:"column:route_strategy"`
	ComplexityLevel string         `json:"complexityLevel" gorm:"column:complexity_level"`
	Conditions      datatypes.JSON `json:"conditions" gorm:"column:conditions"`
	Priority        int            `json:"priority" gorm:"column:priority"`
	Weight          int            `json:"weight" gorm:"column:weight"`
	Status          int            `json:"status" gorm:"column:status"`
}

func (AiModelRoute) TableName() string { return "ai_model_route" }

// AiProviderHealth stores provider health and circuit-breaker state for routing.
type AiProviderHealth struct {
	SoftDeleteModel
	ProviderID        int64           `json:"providerId" gorm:"column:provider_id"`
	HealthStatus      string          `json:"healthStatus" gorm:"column:health_status"`
	FailureRate       decimal.Decimal `json:"failureRate" gorm:"column:failure_rate"`
	AvgLatencyMs      int             `json:"avgLatencyMs" gorm:"column:avg_latency_ms"`
	CircuitOpenUntil  *time.Time      `json:"circuitOpenUntil" gorm:"column:circuit_open_until"`
	ConsecutiveErrors int             `json:"consecutiveErrors" gorm:"column:consecutive_errors"`
	LastError         string          `json:"lastError" gorm:"column:last_error"`
}

func (AiProviderHealth) TableName() string { return "ai_provider_health" }

// AiRouteDecisionLog records the selected route for each generation request.
type AiRouteDecisionLog struct {
	BaseModel
	TaskID           *int64         `json:"taskId" gorm:"column:task_id"`
	UserID           *int64         `json:"userId" gorm:"column:user_id"`
	LogicalModelID   *int64         `json:"logicalModelId" gorm:"column:logical_model_id"`
	UpstreamModelID  *int64         `json:"upstreamModelId" gorm:"column:upstream_model_id"`
	ProviderID       *int64         `json:"providerId" gorm:"column:provider_id"`
	RouteID          *int64         `json:"routeId" gorm:"column:route_id"`
	HandlerName      string         `json:"handlerName" gorm:"column:handler_name"`
	RouteStrategy    string         `json:"routeStrategy" gorm:"column:route_strategy"`
	LogicalModel     string         `json:"logicalModel" gorm:"column:logical_model"`
	UpstreamModel    string         `json:"upstreamModel" gorm:"column:upstream_model"`
	ComplexityLevel  string         `json:"complexityLevel" gorm:"column:complexity_level"`
	ComplexityScore  int            `json:"complexityScore" gorm:"column:complexity_score"`
	DecisionReason   string         `json:"decisionReason" gorm:"column:decision_reason"`
	CandidateCount   int            `json:"candidateCount" gorm:"column:candidate_count"`
	FallbackUsed     int            `json:"fallbackUsed" gorm:"column:fallback_used"`
	DecisionMetadata datatypes.JSON `json:"decisionMetadata" gorm:"column:decision_metadata"`
}

func (AiRouteDecisionLog) TableName() string { return "ai_route_decision_log" }

// AiTask AI任务表 ai_task。前端以 public_id 轮询任务状态。
type AiTask struct {
	PublicModel
	UserID       int64           `json:"-" gorm:"column:user_id"`
	ProjectID    *int64          `json:"-" gorm:"column:project_id"`
	HandlerName  string          `json:"handlerName" gorm:"column:handler_name"`
	ModelID      *int64          `json:"-" gorm:"column:model_id"`
	InputParams  datatypes.JSON  `json:"inputParams" gorm:"column:input_params"`
	ResultURL    string          `json:"resultUrl" gorm:"column:result_url"`
	ResultMeta   datatypes.JSON  `json:"resultMeta" gorm:"column:result_meta"`
	Status       int             `json:"status" gorm:"column:status"`
	Progress     int             `json:"progress" gorm:"column:progress"`
	ErrorMsg     string          `json:"errorMsg" gorm:"column:error_msg"`
	Cost         decimal.Decimal `json:"-" gorm:"column:cost"`
	CompleteTime *time.Time      `json:"completeTime" gorm:"column:complete_time"`
}

// TableName 表名。
func (AiTask) TableName() string { return "ai_task" }

// AiGenerationLog 操作日志表 ai_generation_log（AI生成/文件操作，内部排障，无逻辑删除）。
type AiGenerationLog struct {
	BaseModel
	TaskID         *int64           `gorm:"column:task_id"`
	UserID         *int64           `gorm:"column:user_id"`
	ProjectID      *int64           `gorm:"column:project_id"`
	HandlerName    string           `gorm:"column:handler_name"`
	OperationType  string           `gorm:"column:operation_type"`
	Model          string           `gorm:"column:model"`
	Operation      string           `gorm:"column:operation"`
	RequestURL     string           `gorm:"column:request_url"`
	RequestBody    string           `gorm:"column:request_body"`
	HTTPStatus     *int             `gorm:"column:http_status"`
	ResponseBody   string           `gorm:"column:response_body"`
	UpstreamTaskID string           `gorm:"column:upstream_task_id"`
	Success        int              `gorm:"column:success"`
	ResultURL      string           `gorm:"column:result_url"`
	ErrorMsg       string           `gorm:"column:error_msg"`
	DurationMs     *int64           `gorm:"column:duration_ms"`
	Cost           *decimal.Decimal `gorm:"column:cost"`
}

// TableName 表名。
func (AiGenerationLog) TableName() string { return "ai_generation_log" }
