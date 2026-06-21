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

// taskQuery is the query string of GET /api/ai/tasks (AiTaskQuery).
type taskQuery struct {
	PageNum        int      `form:"pageNum"`
	PageSize       int      `form:"pageSize"`
	OrderBy        string   `form:"orderBy"`
	OrderDirection string   `form:"orderDirection"`
	Handler        string   `form:"handler"`
	Status         *int     `form:"status"`
	ProjectID      idgen.ID `form:"projectId"`
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
	Success       *int     `form:"success"`
}
