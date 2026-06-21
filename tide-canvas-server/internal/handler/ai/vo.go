package ai

import (
	"encoding/json"
	"strconv"
	"strings"
	"time"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

// parseFloat parses a decimal string (e.g. an upstream USD cost) into a float64.
func parseFloat(s string) (float64, error) {
	return strconv.ParseFloat(strings.TrimSpace(s), 64)
}

// timeLayout matches the ISO-ish layout the frontend slices on (it does
// `createTime.replace("T"," ").slice(...)`), so an RFC3339-ish value works.
const timeLayout = "2006-01-02T15:04:05"

// fmtTime formats a time for JSON. Zero times become "" so the frontend's
// optional-chaining (`createTime?.replace`) is a no-op.
func fmtTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.Format(timeLayout)
}

// AiTaskVO mirrors tide-canvas-web/src/types/ai.ts AiTaskVO. resultMeta is sent
// as a JSON object (RawMessage) when the stored value is valid JSON, else as a
// string; the frontend (parseTaskMeta) accepts either form.
type AiTaskVO struct {
	ID           idgen.ID        `json:"id"`
	Handler      string          `json:"handler"`
	ModelName    string          `json:"modelName"`
	Status       int             `json:"status"`
	Progress     int             `json:"progress"`
	ResultURL    string          `json:"resultUrl"`
	ResultMeta   json.RawMessage `json:"resultMeta"`
	ErrorMsg     string          `json:"errorMsg"`
	CreateTime   string          `json:"createTime"`
	CompleteTime string          `json:"completeTime"`
}

// rawJSONOrString returns s as a JSON value: the parsed object/array when s is
// valid JSON, otherwise a JSON string literal. Empty s becomes an empty object.
func rawJSONOrString(s string) json.RawMessage {
	s = strings.TrimSpace(s)
	if s == "" {
		return json.RawMessage("{}")
	}
	if json.Valid([]byte(s)) {
		return json.RawMessage(s)
	}
	b, _ := json.Marshal(s)
	return json.RawMessage(b)
}

func toTaskVO(t *model.AiTask) AiTaskVO {
	return AiTaskVO{
		ID:           t.ID,
		Handler:      t.Handler,
		ModelName:    t.ModelName,
		Status:       t.Status,
		Progress:     t.Progress,
		ResultURL:    t.ResultUrl,
		ResultMeta:   rawJSONOrString(t.ResultMeta),
		ErrorMsg:     t.ErrorMsg,
		CreateTime:   fmtTime(t.CreateTime),
		CompleteTime: fmtTime(t.CompleteTime),
	}
}

// AiModelVO mirrors AiModelVO in types/ai.ts. supportedHandlers is parsed from
// the stored JSON text into a slice (null/empty => no restriction). config stays
// a raw string (frontend treats it as an opaque string).
type AiModelVO struct {
	ID                idgen.ID `json:"id"`
	Name              string   `json:"name"`
	Icon              string   `json:"icon"`
	ModelID           string   `json:"modelId"`
	Type              string   `json:"type"`
	SupportedHandlers []string `json:"supportedHandlers"`
	Config            string   `json:"config"`
	PointCost         int64    `json:"pointCost"`
}

// parseHandlers parses the stored supportedHandlers text. It accepts a JSON
// array (`["a","b"]`) or a comma-separated list; empty input yields nil.
func parseHandlers(s string) []string {
	s = strings.TrimSpace(s)
	if s == "" || s == "null" || s == "[]" {
		return nil
	}
	var arr []string
	if json.Unmarshal([]byte(s), &arr) == nil {
		return cleanStrings(arr)
	}
	return cleanStrings(strings.Split(s, ","))
}

func cleanStrings(in []string) []string {
	out := make([]string, 0, len(in))
	for _, v := range in {
		if v = strings.TrimSpace(v); v != "" {
			out = append(out, v)
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func toModelVO(m *model.AiModel) AiModelVO {
	return AiModelVO{
		ID:                m.ID,
		Name:              m.Name,
		Icon:              m.Icon,
		ModelID:           m.ModelID,
		Type:              m.Type,
		SupportedHandlers: parseHandlers(m.SupportedHandlers),
		Config:            m.Config,
		PointCost:         m.PointCost,
	}
}

// AiHandlerVO mirrors AiHandlerVO in types/ai.ts. inputSchema is emitted as a
// JSON object; defaultModelId is a string id (idgen.ID) per the string-id rule.
type AiHandlerVO struct {
	HandlerName    string          `json:"handlerName"`
	Name           string          `json:"name"`
	DisplayName    string          `json:"displayName"`
	Description    string          `json:"description"`
	InputSchema    json.RawMessage `json:"inputSchema"`
	IsAsync        bool            `json:"isAsync"`
	DefaultModelID idgen.ID        `json:"defaultModelId"`
	PointCost      int64           `json:"pointCost"`
}

func toHandlerVO(h *model.AiHandler) AiHandlerVO {
	return AiHandlerVO{
		HandlerName:    h.HandlerName,
		Name:           h.Name,
		DisplayName:    h.DisplayName,
		Description:    h.Description,
		InputSchema:    rawJSONOrString(h.InputSchema),
		IsAsync:        h.IsAsync,
		DefaultModelID: h.DefaultModelID,
		PointCost:      h.PointCost,
	}
}

// AiGenerationLogVO mirrors AiGenerationLogVO in types/ai.ts. Association display
// fields (userName/projectName/taskStatus) are filled by the service. inputParams
// is only populated on the detail path; cost is the upstream USD cost when known.
type AiGenerationLogVO struct {
	ID             idgen.ID `json:"id"`
	TaskID         idgen.ID `json:"taskId"`
	UserID         idgen.ID `json:"userId"`
	ProjectID      idgen.ID `json:"projectId"`
	HandlerName    string   `json:"handlerName"`
	OperationType  string   `json:"operationType"`
	Model          string   `json:"model"`
	Operation      string   `json:"operation"`
	RequestURL     string   `json:"requestUrl"`
	RequestBody    string   `json:"requestBody"`
	InputParams    string   `json:"inputParams,omitempty"`
	HttpStatus     int      `json:"httpStatus"`
	ResponseBody   string   `json:"responseBody"`
	UpstreamTaskID string   `json:"upstreamTaskId"`
	Success        int      `json:"success"`
	ResultURL      string   `json:"resultUrl"`
	ErrorMsg       string   `json:"errorMsg"`
	DurationMs     int64    `json:"durationMs"`
	Cost           *float64 `json:"cost,omitempty"`
	CreateTime     string   `json:"createTime"`

	UserName    string `json:"userName,omitempty"`
	ProjectName string `json:"projectName,omitempty"`
	TaskStatus  *int   `json:"taskStatus,omitempty"`
}

func toLogVO(l *model.AiGenerationLog) AiGenerationLogVO {
	vo := AiGenerationLogVO{
		ID:             l.ID,
		TaskID:         l.TaskID,
		UserID:         l.UserID,
		ProjectID:      l.ProjectID,
		HandlerName:    l.HandlerName,
		OperationType:  l.OperationType,
		Model:          l.Model,
		Operation:      l.Operation,
		RequestURL:     l.RequestUrl,
		RequestBody:    l.RequestBody,
		HttpStatus:     l.HttpStatus,
		ResponseBody:   l.ResponseBody,
		UpstreamTaskID: l.UpstreamTaskID,
		Success:        l.Success,
		ResultURL:      l.ResultUrl,
		ErrorMsg:       l.ErrorMsg,
		DurationMs:     l.DurationMs,
		CreateTime:     fmtTime(l.CreateTime),
	}
	if c := strings.TrimSpace(l.Cost); c != "" {
		if f, err := parseFloat(c); err == nil {
			vo.Cost = &f
		}
	}
	return vo
}
