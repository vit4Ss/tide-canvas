package ai

import (
	"encoding/json"

	"tidecanvas/internal/pkg/idgen"
)

// generateDTO is the body of POST /api/ai/generate.
//
// Matches the frontend AiGenerateDTO (tide-canvas-web/src/types/ai.ts):
//
//	{ handler: string; modelId: string; projectId?: string|number; input: Record<string,unknown> }
//
// Note: modelId here is the UPSTREAM model identifier string the frontend
// selects from AiModelVO.modelId — NOT the AiModel primary key. The service
// resolves the AiModel by its ModelID column (falling back to the numeric PK).
type generateDTO struct {
	Handler   string          `json:"handler"`
	ModelID   string          `json:"modelId"`
	ProjectID idgen.ID        `json:"projectId"`
	Input     json.RawMessage `json:"input"`
	// Placement is required when input.skillId is present. Legacy HTTP callers
	// default to the Studio surface and wildcard target.
	EntryPoint string `json:"entryPoint"`
	TargetType string `json:"targetType"`
	// Optional for legacy compatibility; official clients always send it.
	// When supplied, retries with the same request return the original task.
	ClientRequestID string `json:"clientRequestId"`
	// The fields below are internal-only orchestration metadata populated by the
	// exported GenerationFacade. They are never accepted from the HTTP body.
	Origin            string   `json:"-"`
	SkillRunID        idgen.ID `json:"-"`
	SkillRunStepID    idgen.ID `json:"-"`
	SkillRunRevision  int64    `json:"-"`
	SkillRunWorkerID  string   `json:"-"`
	OutputRole        string   `json:"-"`
	RegisterWork      *bool    `json:"-"`
	PinnedSkillPrompt string   `json:"-"`
}

// upscaleQuoteDTO requests an authoritative pre-submit quote. The service
// verifies video ownership and probes duration exactly like generate(); the
// generation path still rechecks so a quote can never authorize a later debit.
type upscaleQuoteDTO struct {
	ModelID          string `json:"modelId"`
	VideoURL         string `json:"videoUrl"`
	TargetResolution string `json:"targetResolution"`
}

type upscaleQuoteVO struct {
	DurationSeconds float64 `json:"durationSeconds"`
	RatePerSecond   float64 `json:"ratePerSecond"`
	PointCost       int     `json:"pointCost"`
	Resolution      string  `json:"resolution"`
}

// gridSplitDTO is the body of POST /api/ai/grid-split.
//
// Matches the frontend aiApi.gridSplit payload:
//
//	{ imageUrl: string; rows: number; cols: number; cells?: number[] }
type gridSplitDTO struct {
	ImageURL string `json:"imageUrl"`
	Rows     int    `json:"rows"`
	Cols     int    `json:"cols"`
	Cells    []int  `json:"cells"`
}

// capturedFrameDTO promotes a freshly uploaded PNG/JPEG into generation history.
// FileID is authoritative: the service verifies that the upload belongs to the
// caller, creates a completed AiTask, then removes the ordinary upload record in
// the same transaction so the frame appears in exactly one asset collection.
type capturedFrameDTO struct {
	FileID      idgen.ID `json:"fileId"`
	CaptureTime float64  `json:"captureTime"`
	Width       int      `json:"width"`
	Height      int      `json:"height"`
}

// taskQuery is the query string of GET /api/ai/tasks (AiTaskQuery).
type taskQuery struct {
	PageNum        int    `form:"pageNum"`
	PageSize       int    `form:"pageSize"`
	OrderBy        string `form:"orderBy"`
	OrderDirection string `form:"orderDirection"`
	Handler        string `form:"handler"`
	// MediaType/AssetOnly are used by the assets page so filtering happens
	// before pagination instead of dropping non-matching rows in the browser.
	MediaType     string `form:"mediaType"`
	AssetCategory string `form:"assetCategory"`
	AssetOnly     bool   `form:"assetOnly"`
	// ExcludeTools keeps independent smart-tool output out of Studio history.
	// Assets and the Tools hub omit this flag, so the same tasks remain visible there.
	ExcludeTools bool `form:"excludeTools"`
	// ExcludeCaptures keeps derived video frames in Assets · 生成历史 without
	// rendering them as replayable model runs in the Studio timeline.
	ExcludeCaptures bool     `form:"excludeCaptures"`
	Status          *int     `form:"status"`
	ProjectID       idgen.ID `form:"projectId"`
	// NoProject=true 只返回不属于任何画布项目的任务（project_id=0，即创作台/对话页
	// 发起的生成）；与 ProjectID 互斥，同时传时以 NoProject 为准。
	NoProject bool `form:"noProject"`
	// 时间筛选(资产库「时间筛选」):按 create_time 过滤,startDate 当天 00:00 起,
	// endDate 纯日期按「次日 00:00 前」含当天;支持 YYYY-MM-DD 或完整时间。
	StartDate string `form:"startDate"`
	EndDate   string `form:"endDate"`
}

// logQuery is the query string of GET /api/ai/logs (AiGenerationLogQuery).
type logQuery struct {
	PageNum       int      `form:"pageNum"`
	PageSize      int      `form:"pageSize"`
	TaskID        idgen.ID `form:"taskId"`
	UserID        idgen.ID `form:"userId"`
	ProjectID     idgen.ID `form:"projectId"`
	HandlerName   string   `form:"handlerName"`
	OperationType string   `form:"operationType"`
	MediaType     string   `form:"mediaType"`
	Keyword       string   `form:"keyword"`
	Success       *int     `form:"success"`
	StartDate     string   `form:"startDate"`
	EndDate       string   `form:"endDate"`
}

// userHistoryQuery is intentionally narrower than logQuery. Public history
// may filter product records but cannot query audit-only dimensions such as
// user id, handler name, operation type or upstream task id.
type userHistoryQuery struct {
	PageNum   int      `form:"pageNum"`
	PageSize  int      `form:"pageSize"`
	ProjectID idgen.ID `form:"projectId"`
	MediaType string   `form:"mediaType"`
	Keyword   string   `form:"keyword"`
	Success   *int     `form:"success"`
	StartDate string   `form:"startDate"`
	EndDate   string   `form:"endDate"`
}
