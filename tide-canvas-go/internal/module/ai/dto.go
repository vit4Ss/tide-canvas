// Package ai AI 生成模块（平台最核心）：统一生成入口 / 任务轮询 / 取消 / 历史 / 图片宫格切分，
// 以及供应商(provider) / 模型(model) / Handler 配置的管理端 CRUD。
//
// 忠实迁移旧后端 AiController + AdminAiController + AiServiceImpl + service/ai 整个目录
// （AiHandler/Registry、AiMediaGateway、AiRelayClient(中转站 OpenAI 风格)、RunwareClient(原生协议)、
// 各 Handler、ImageGridServiceImpl、AiTaskRunner、AiTaskRecoveryRunner、GenerationLog* 上下文）。
//
// 分层：dto / deps（注入接口）/ repository / client（上游）/ handler_registry（业务 Handler）/
// service（编排+异步+收尾）/ grid（宫格）/ handler（用户 HTTP）/ admin（管理端 HTTP+服务）。
//
// 对外 ID 规范：ai_task / ai_model 对外用 public_id；provider/handler 配置为管理端资源，
// 沿用旧实现按内部主键(int64) / handlerName 操作（与 admin 模块 role/邮件模板一致）。
package ai

import (
	"fmt"
	"math"
	"strconv"
	"strings"

	"github.com/shopspring/decimal"

	"github.com/tidecanvas/tide-canvas-go/internal/module/points"
)

// AI 积分交易类型（复用 points 包导出常量，避免硬编码数值；扣费 AI_CONSUME=3 / 退款 AI_REFUND=8）。
const (
	txTypeAIConsume = points.TxAIConsume
	txTypeAIRefund  = points.TxAIRefund
)

// ===== 任务状态（对齐旧 AiTaskStatusEnum 的 code）=====
const (
	TaskProcessing = 0 // 处理中
	TaskSuccess    = 1 // 成功
	TaskFailed     = 2 // 失败
	TaskCancelled  = 3 // 已取消
)

// providerTypeRunware Runware 原生协议供应商类型标识（对齐 AiMediaGateway.PROVIDER_TYPE_RUNWARE）。
const providerTypeRunware = "runware"

// defaultPointCost 单价兜底（model / handler 均未配置时），对齐 AiServiceImpl.DEFAULT_POINT_COST = BigDecimal.TEN。
var defaultPointCost = decimal.NewFromInt(10)

// PLACEHOLDER 演示模式占位图（内联 1x1 透明 PNG），未配置可用供应商时回退，
// 避免浏览器因外部假 URL 报 "Unsafe asset URL"（对齐各 Handler 的 PLACEHOLDER）。
const placeholderImage = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

// ---- 分页查询基类（对齐旧 PageQuery 默认值与边界：pageNum>=1，1<=pageSize<=100，默认20）----

// PageQuery 分页查询基类。
type PageQuery struct {
	PageNum  int `form:"pageNum"`
	PageSize int `form:"pageSize"`
}

// normalize 校正分页参数。
func (q *PageQuery) normalize() {
	if q.PageNum < 1 {
		q.PageNum = 1
	}
	if q.PageSize < 1 {
		q.PageSize = 20
	}
	if q.PageSize > 100 {
		q.PageSize = 100
	}
}

// Offset 返回 SQL OFFSET。
func (q *PageQuery) Offset() int { return (q.PageNum - 1) * q.PageSize }

// ===== 请求 DTO =====

// GenerateDTO 统一生成入口请求（对齐 AiGenerateDTO）。
// input 为前端透传的生成参数（prompt / sourceImage / aspectRatio / batchCount 等），由各 Handler 校验消费。
type GenerateDTO struct {
	Handler   string                 `json:"handler"`
	ModelID   string                 `json:"modelId"`
	ProjectID string                 `json:"projectId"` // 画布 public_id（可空，旧版为内部主键 projectId）
	Input     map[string]interface{} `json:"input"`
}

// GridSplitDTO 图片宫格切分请求：将 imageUrl 指向的图片均匀切成 rows×cols 块（对齐 GridSplitDTO）。
type GridSplitDTO struct {
	ImageURL string `json:"imageUrl"`
	Rows     int    `json:"rows"`
	Cols     int    `json:"cols"`
	// Cells 仅切分这些格子（行优先 0-based 索引）；为空则切分全部。
	Cells []int `json:"cells"`
}

// ===== 列表查询 =====

// TaskQuery 我的任务列表查询（对齐 AiTaskQuery extends PageQuery）。ProjectID 为画布 public_id。
type TaskQuery struct {
	PageQuery
	Handler   string `form:"handler"`
	Status    *int   `form:"status"`
	ProjectID string `form:"projectId"`
}

// GenerationLogQuery AI 生成 / 操作日志查询（对齐 AiGenerationLogQuery extends PageQuery）。
// 用户侧仅用 ProjectID；管理端用全部字段。userId/taskId/projectId 在 handler 中由 public_id 解析为内部主键。
type GenerationLogQuery struct {
	PageQuery
	TaskID        *int64 `form:"taskId"`
	UserID        *int64 `form:"userId"`
	ProjectID     *int64 `form:"projectId"`
	HandlerName   string `form:"handlerName"`
	OperationType string `form:"operationType"`
	Success       *int   `form:"success"`
}

// ===== 视图 VO =====

// TaskVO AI 任务视图（对齐 AiTaskVO）。id 为 public_id。
type TaskVO struct {
	ID           string  `json:"id"` // public_id
	HandlerName  string  `json:"handlerName"`
	ModelName    string  `json:"modelName"`
	Status       int     `json:"status"`
	Progress     int     `json:"progress"`
	ResultURL    string  `json:"resultUrl"`
	ResultMeta   string  `json:"resultMeta"`
	ErrorMsg     string  `json:"errorMsg"`
	CreateTime   string  `json:"createTime"`
	CompleteTime *string `json:"completeTime"`
}

// ModelVO AI 模型视图（对齐 AiModelVO）。id 为 public_id。
// CostPerCall（上游成本 USD）为商业敏感信息：用户侧置空脱敏，管理端返回。
type ModelVO struct {
	ID                string           `json:"id"` // public_id
	Name              string           `json:"name"`
	Icon              string           `json:"icon"`
	ModelID           string           `json:"modelId"`
	Type              string           `json:"type"`
	SupportedHandlers []string         `json:"supportedHandlers"` // 空/缺省表示不限制
	Config            string           `json:"config"`
	PointCost         decimal.Decimal  `json:"pointCost"`
	CostPerCall       *decimal.Decimal `json:"costPerCall"` // 仅管理端
	Status            int              `json:"status"`
	ProviderID        *int64           `json:"providerId"`
	ProviderName      string           `json:"providerName"` // 管理端展示
	CreateTime        string           `json:"createTime"`
}

// HandlerVO Handler 配置视图（对齐 AiHandlerVO）。
type HandlerVO struct {
	HandlerName    string          `json:"handlerName"`
	DisplayName    string          `json:"displayName"`
	Description    string          `json:"description"`
	InputSchema    string          `json:"inputSchema"`
	AsyncFlag      int             `json:"asyncFlag"`
	DefaultModelID *int64          `json:"defaultModelId"`
	PointCost      decimal.Decimal `json:"pointCost"`
}

// ProviderVO 供应商视图（对齐 AiProviderVO）。id 为内部主键。ApiKey 脱敏（前4+后4）。
type ProviderVO struct {
	ID           int64  `json:"id"`
	Name         string `json:"name"`
	ProviderType string `json:"providerType"`
	BaseURL      string `json:"baseUrl"`
	APIKey       string `json:"apiKey"` // 脱敏
	Status       int    `json:"status"`
	Priority     int    `json:"priority"`
	RateLimit    int    `json:"rateLimit"`
	Config       string `json:"config"`
	CreateTime   string `json:"createTime"`
}

// GenerationLogVO AI 生成 / 操作日志视图（对齐 AiGenerationLogVO）。id 为内部主键（日志为内部排障资源）。
type GenerationLogVO struct {
	ID             int64            `json:"id"`
	TaskID         *int64           `json:"taskId"`
	UserID         *int64           `json:"userId"`
	ProjectID      *int64           `json:"projectId"`
	HandlerName    string           `json:"handlerName"`
	OperationType  string           `json:"operationType"`
	Model          string           `json:"model"`
	Operation      string           `json:"operation"`
	RequestURL     string           `json:"requestUrl"`
	RequestBody    string           `json:"requestBody"`
	InputParams    string           `json:"inputParams"` // 仅详情回填（取自 ai_task.input_params）
	HTTPStatus     *int             `json:"httpStatus"`
	ResponseBody   string           `json:"responseBody"`
	UpstreamTaskID string           `json:"upstreamTaskId"`
	Success        int              `json:"success"`
	ResultURL      string           `json:"resultUrl"`
	ErrorMsg       string           `json:"errorMsg"`
	DurationMs     *int64           `json:"durationMs"`
	Cost           *decimal.Decimal `json:"cost"`
	CreateTime     string           `json:"createTime"`
	// 关联展示字段（按 id 回填，非日志表本身列）
	UserName    string `json:"userName"`
	ProjectName string `json:"projectName"`
	TaskStatus  *int   `json:"taskStatus"`
}

// ===== 输入参数读取辅助（input 为 map[string]interface{}，统一类型归一）=====

// strOf 取字符串，nil→""（对齐旧 String.valueOf 语义：JSON 数字 5.0 归一为 "5"）。
func strOf(v interface{}) string {
	if v == nil {
		return ""
	}
	switch t := v.(type) {
	case string:
		return t
	case float64:
		// JSON 数字默认 float64；整数去掉小数尾（5.0 → "5"）
		return strconv.FormatFloat(t, 'f', -1, 64)
	case bool:
		if t {
			return "true"
		}
		return "false"
	default:
		return fmt.Sprintf("%v", v)
	}
}

// hasText 非空白。
func hasText(s string) bool { return strings.TrimSpace(s) != "" }

// batchCountOf 出图张数：取 input.batchCount / input.n，clamp 到 [1,4]，缺省 1
// （对齐 AiServiceImpl.batchCountOf / 各 client.batchCountOf）。
func batchCountOf(input map[string]interface{}) int {
	if input == nil {
		return 1
	}
	v, ok := input["batchCount"]
	if !ok || v == nil {
		v = input["n"]
	}
	if v == nil {
		return 1
	}
	n, err := strconv.Atoi(strings.TrimSpace(strOf(v)))
	if err != nil {
		return 1
	}
	if n < 1 {
		n = 1
	}
	if n > 4 {
		n = 4
	}
	return n
}

// ceilToInt 总价向上取整为整数积分（signum<=0 → 0），对齐 total.setScale(0, CEILING)。
func ceilToInt(total decimal.Decimal) int {
	if total.Sign() <= 0 {
		return 0
	}
	f, _ := total.Float64()
	return int(math.Ceil(f - 1e-9))
}

// maskAPIKey API Key 脱敏：>8 位取前4+****+后4，否则 ****（对齐 AdminAiController.listProviders）。
func maskAPIKey(key string) string {
	if key == "" {
		return ""
	}
	if len(key) > 8 {
		return key[:4] + "****" + key[len(key)-4:]
	}
	return "****"
}
