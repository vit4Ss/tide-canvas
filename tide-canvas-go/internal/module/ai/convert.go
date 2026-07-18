package ai

import (
	"encoding/json"
	"strings"

	"github.com/shopspring/decimal"
	"github.com/tidwall/gjson"
	"gorm.io/datatypes"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
)

// dateTimeLayout 统一输出给前端的时间格式。
const dateTimeLayout = "2006-01-02 15:04:05"

// toTaskVO 将任务实体转换为前端任务视图。
func (s *Service) toTaskVO(t *model.AiTask, modelName string) *TaskVO {
	vo := &TaskVO{
		ID:          t.PublicID,
		HandlerName: t.HandlerName,
		ModelName:   modelName,
		Status:      t.Status,
		Progress:    t.Progress,
		ResultURL:   t.ResultURL,
		ResultMeta:  string(t.ResultMeta),
		ErrorMsg:    t.ErrorMsg,
		CreateTime:  t.CreateTime.Format(dateTimeLayout),
	}
	if t.CompleteTime != nil {
		ct := t.CompleteTime.Format(dateTimeLayout)
		vo.CompleteTime = &ct
	}
	return vo
}

// toTaskVOWithModel 转换单个任务并补齐模型名称。
func (s *Service) toTaskVOWithModel(t *model.AiTask) *TaskVO {
	modelName := ""
	if t.ModelID != nil {
		names, err := s.repo.ModelNames([]int64{*t.ModelID})
		if err == nil {
			modelName = names[*t.ModelID]
		}
	}
	return s.toTaskVO(t, modelName)
}

// toTaskVOList 批量转换任务，避免逐条查询模型名称。
func (s *Service) toTaskVOList(tasks []model.AiTask) []TaskVO {
	ids := make([]int64, 0, len(tasks))
	for i := range tasks {
		if tasks[i].ModelID != nil {
			ids = append(ids, *tasks[i].ModelID)
		}
	}
	names, _ := s.repo.ModelNames(ids)
	out := make([]TaskVO, 0, len(tasks))
	for i := range tasks {
		name := ""
		if tasks[i].ModelID != nil {
			name = names[*tasks[i].ModelID]
		}
		out = append(out, *s.toTaskVO(&tasks[i], name))
	}
	return out
}

// toModelVO 将模型实体转换为管理端/用户端通用视图。
func toModelVO(m *model.AiModel, providerName string) ModelVO {
	vo := ModelVO{
		ID:                m.PublicID,
		Name:              m.Name,
		Icon:              m.Icon,
		ModelID:           m.ModelID,
		Type:              m.Type,
		SupportedHandlers: parseSupportedHandlers(m.SupportedHandlers),
		Capabilities:      decodeCapabilities(m),
		Config:            string(m.Config),
		PointCost:         m.PointCost,
		Status:            m.Status,
		ProviderName:      providerName,
		CreateTime:        m.CreateTime.Format(dateTimeLayout),
	}
	if m.ProviderID != 0 {
		pid := m.ProviderID
		vo.ProviderID = &pid
	}
	cost := m.CostPerCall
	vo.CostPerCall = &cost
	return vo
}

// toIconAssetVO 将图标资产转换为管理端视图。
func toIconAssetVO(asset *model.AiIconAsset) IconAssetVO {
	return IconAssetVO{
		ID:         asset.PublicID,
		Name:       asset.Name,
		IconURL:    asset.IconURL,
		FileID:     asset.FileID,
		MimeType:   asset.MimeType,
		FileSize:   asset.FileSize,
		Status:     asset.Status,
		SortOrder:  asset.SortOrder,
		CreateTime: asset.CreateTime.Format(dateTimeLayout),
	}
}

// toHandlerVO 将 Handler 配置转换为视图对象。
func toHandlerVO(c *model.AiHandlerConfig) HandlerVO {
	return HandlerVO{
		HandlerName:    c.HandlerName,
		DisplayName:    c.DisplayName,
		Description:    c.Description,
		InputSchema:    string(c.InputSchema),
		AsyncFlag:      c.AsyncFlag,
		DefaultModelID: c.DefaultModelID,
		PointCost:      c.PointCost,
	}
}

// toProviderVO 将供应商转换为管理端视图，并脱敏 API Key。
func toProviderVO(p *model.AiProvider) ProviderVO {
	return ProviderVO{
		ID:           p.ID,
		Name:         p.Name,
		ProviderType: p.ProviderType,
		BaseURL:      p.BaseURL,
		APIKey:       maskAPIKey(p.APIKey),
		Status:       p.Status,
		Priority:     p.Priority,
		RateLimit:    p.RateLimit,
		Config:       string(p.Config),
		CreateTime:   p.CreateTime.Format(dateTimeLayout),
	}
}

// toLogVO 将生成日志转换为管理端视图。
func toLogVO(d *model.AiGenerationLog) GenerationLogVO {
	return GenerationLogVO{
		ID:             d.ID,
		TaskID:         d.TaskID,
		UserID:         d.UserID,
		ProjectID:      d.ProjectID,
		HandlerName:    d.HandlerName,
		OperationType:  d.OperationType,
		Model:          d.Model,
		Operation:      d.Operation,
		RequestURL:     d.RequestURL,
		RequestBody:    d.RequestBody,
		HTTPStatus:     d.HTTPStatus,
		ResponseBody:   d.ResponseBody,
		UpstreamTaskID: d.UpstreamTaskID,
		Success:        d.Success,
		ResultURL:      d.ResultURL,
		ErrorMsg:       d.ErrorMsg,
		DurationMs:     d.DurationMs,
		Cost:           d.Cost,
		CreateTime:     d.CreateTime.Format(dateTimeLayout),
	}
}

// parseSupportedHandlers 解析模型支持的生成方式；空值表示不限制。
func parseSupportedHandlers(j datatypes.JSON) []string {
	if len(j) == 0 {
		return nil
	}
	var out []string
	if err := json.Unmarshal(j, &out); err != nil {
		return nil
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func decodeJSONObject(j datatypes.JSON) map[string]any {
	if len(j) == 0 || string(j) == "null" {
		return map[string]any{}
	}
	var out map[string]any
	if err := json.Unmarshal(j, &out); err != nil || out == nil {
		return map[string]any{}
	}
	return out
}

// pricingFromConfig 从模型配置的 pricing 矩阵中读取当前输入对应的单价。
func pricingFromConfig(config string, input map[string]interface{}, modelType string) (decimal.Decimal, bool) {
	if !hasText(config) || input == nil {
		return decimal.Zero, false
	}
	root := tryParseJSON(config)
	pricing := root.Get("pricing")
	if !pricing.IsObject() {
		return decimal.Zero, false
	}
	var rowKey, colKey string
	if modelType == "video" {
		rowKey = strOf(input["resolution"])
		colKey = strOf(input["duration"])
	} else {
		rowKey = strOf(input["quality"])
		colKey = strOf(input["clarity"])
	}
	cell := pricing.Get(escapeKey(rowKey)).Get(escapeKey(colKey))
	if cell.Exists() && cell.Type == gjson.Number {
		return decimal.NewFromFloat(cell.Float()), true
	}
	return decimal.Zero, false
}

// escapeKey 转义 gjson 路径中的特殊字符。
func escapeKey(k string) string {
	return strings.ReplaceAll(k, ".", `\.`)
}

// toJSON 将任意对象转换为 datatypes.JSON，失败时回退为空对象。
func toJSON(v interface{}) datatypes.JSON {
	if v == nil {
		return datatypes.JSON("{}")
	}
	b, err := json.Marshal(v)
	if err != nil {
		return datatypes.JSON("{}")
	}
	return datatypes.JSON(b)
}

// containsInt64 判断 int64 列表是否包含指定值。
func containsInt64(list []int64, v int64) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

// intFromDecimal 将 decimal 转换为 int。
func intFromDecimal(d decimal.Decimal) int {
	return int(d.IntPart())
}

// truncate 截断超长字符串，避免日志体过大。
func truncate(s string, max int) string {
	if len(s) > max {
		return s[:max] + "...[truncated]"
	}
	return s
}

// boolToInt 将布尔值转换为数据库中的 1/0。
func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// blankNil 将空白字符串归一为空串。
func blankNil(s string) string {
	if strings.TrimSpace(s) == "" {
		return ""
	}
	return s
}

// isHTTPURL 判断是否为 http(s) 地址。
func isHTTPURL(s string) bool {
	return strings.HasPrefix(s, "http://") || strings.HasPrefix(s, "https://")
}

// taskProgress 将上游轮询进度回写到任务记录。
type taskProgress struct {
	repo   *Repository
	taskID int64
}

// report 回写任务进度；失败时静默处理，不影响生成链路。
func (p *taskProgress) report(progress int) {
	if p == nil || p.repo == nil {
		return
	}
	_ = p.repo.UpdateProgressIfProcessing(p.taskID, progress)
}

// reportText persists partial assistant output and returns false once the task was cancelled.
func (p *taskProgress) reportText(content string) bool {
	if p == nil || p.repo == nil {
		return true
	}
	active, err := p.repo.UpdateStreamingTextIfProcessing(p.taskID, content)
	return err == nil && active
}
