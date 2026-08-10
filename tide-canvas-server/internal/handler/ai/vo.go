package ai

import (
	"encoding/json"
	"errors"
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

// fmtTimePtr formats a nullable time (nil/zero → empty string).
func fmtTimePtr(t *time.Time) string {
	if t == nil {
		return ""
	}
	return fmtTime(*t)
}

// AiTaskVO mirrors tide-canvas-web/src/types/ai.ts AiTaskVO. resultMeta is sent
// as a JSON object (RawMessage) when the stored value is valid JSON, else as a
// string; the frontend (parseTaskMeta) accepts either form.
type AiTaskVO struct {
	ID         idgen.ID `json:"id"`
	Handler    string   `json:"handler"`
	TargetType string   `json:"targetType"`
	// ModelID is the AiModel row id (matches AiModelVO.id)。延长/翻唱须发到
	// 与原曲相同的模型卡(上游按 key 钉路由),前端据此把模型选回原曲那张。
	ModelID   idgen.ID `json:"modelId"`
	ModelName string   `json:"modelName"`
	Status    int      `json:"status"`
	Progress  int      `json:"progress"`
	// PointCost is the points charged for this task (server-computed at submit).
	PointCost  int64           `json:"pointCost"`
	ResultURL  string          `json:"resultUrl"`
	ResultMeta json.RawMessage `json:"resultMeta"`
	ErrorMsg   string          `json:"errorMsg"`
	// Input is the original generation request (prompt/ratio/resolution/…) so the
	// 创作台 can restore the run's settings from history (重新编辑 / 再次生成).
	Input        json.RawMessage `json:"input"`
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
		TargetType:   t.TargetType,
		ModelID:      t.ModelID,
		ModelName:    t.ModelName,
		Status:       t.Status,
		Progress:     t.Progress,
		PointCost:    t.PointCost,
		ResultURL:    t.ResultUrl,
		ResultMeta:   rawJSONOrString(t.ResultMeta),
		ErrorMsg:     t.ErrorMsg,
		Input:        rawJSONOrString(t.Input),
		CreateTime:   fmtTime(t.CreateTime),
		CompleteTime: fmtTimePtr(t.CompleteTime),
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

// AiToolVO mirrors AiToolVO in types/ai.ts — the public shape of a 智能工具
// (config-driven one-click edit). PresetPrompt 是服务端资产，故意不外发。
// cover 是 CoverHues 解码出的 [h1,h2,h3] 色相数组（解析失败为 null）；
// extraParams 是解码后的参数对象（空/非法为 null）。
type AiToolVO struct {
	Key   string `json:"key"`
	Title string `json:"title"`
	Desc  string `json:"desc"`
	// Type 决定工具页收什么素材(image|video)。
	Type        string         `json:"type"`
	Handler     string         `json:"handler"`
	NeedPrompt  bool           `json:"needPrompt"`
	Hd          bool           `json:"hd"`
	Icon        string         `json:"icon"`
	Cover       []int          `json:"cover"`
	Placeholder string         `json:"placeholder"`
	ExtraParams map[string]any `json:"extraParams"`
	SortOrder   int            `json:"sortOrder"`
}

// toolTypeOrDefault normalizes a stored ai_tools.type. 旧库在该列存在之前建的
// 行为空串,按图片工具处理(既有工具全是图片形态),客户端因此永远拿到有效值。
func toolTypeOrDefault(t string) string {
	if t == model.AiToolTypeVideo {
		return model.AiToolTypeVideo
	}
	return model.AiToolTypeImage
}

// decodeToolHues parses a stored cover_hues value ("[h1,h2,h3]") into an int
// slice; nil (serialized as null) when empty/unparsable so the frontend falls
// back to its neutral cover art.
func decodeToolHues(s string) []int {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	var hues []int
	if json.Unmarshal([]byte(s), &hues) != nil || len(hues) == 0 {
		return nil
	}
	return hues
}

// decodeToolExtra parses a stored extra_params JSON object; nil when empty or
// invalid（调用方退回内建默认值）。An explicit "{}" decodes to a non-nil empty
// map — 管理员用它清空某个工具的内建附加参数。
func decodeToolExtra(s string) map[string]any {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	m := map[string]any{}
	if json.Unmarshal([]byte(s), &m) != nil {
		return nil
	}
	return m
}

func toToolVO(t *model.AiTool) AiToolVO {
	return AiToolVO{
		Key:         t.Key,
		Title:       t.Title,
		Desc:        t.Desc,
		Type:        toolTypeOrDefault(t.Type),
		Handler:     t.Handler,
		NeedPrompt:  t.NeedPrompt,
		Hd:          t.Hd,
		Icon:        t.Icon,
		Cover:       decodeToolHues(t.CoverHues),
		Placeholder: t.Placeholder,
		ExtraParams: decodeToolExtra(t.ExtraParams),
		SortOrder:   t.SortOrder,
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

// redactForUser 抹掉普通用户不该拿到的上游细节。
//
// GET /api/ai/logs 只挂 JWTAuth(见 register.go),isAdmin 决定的是「看谁的行」
// 而不是「能不能看」——画布「历史」面板正是走这条路,且把 errorMsg 原样渲染。
// 不脱敏的话 userFacingGenError 在这条链路上等于没做:供应商名、上游 request
// ID、中转站地址、请求/响应原文全都出站。
//
// errorMsg 走与任务失败完全相同的话术(同一个 userFacingGenError,口径不分叉);
// 其余字段对用户无用且属内部信息,整体清空:
//   - requestUrl/requestBody/responseBody:中转站地址与上游原文
//   - upstreamTaskId:供应商侧任务标识
//   - cost:上游 USD 成本,属经营数据
//
// 管理员不走这里(后台「模型调用日志」仍是全量原文,排查能力不变)。
func (vo *AiGenerationLogVO) redactForUser() {
	if vo.ErrorMsg != "" {
		vo.ErrorMsg = userFacingGenError(errors.New(vo.ErrorMsg))
	}
	vo.RequestURL = ""
	vo.RequestBody = ""
	vo.ResponseBody = ""
	vo.UpstreamTaskID = ""
	vo.Cost = nil
}
