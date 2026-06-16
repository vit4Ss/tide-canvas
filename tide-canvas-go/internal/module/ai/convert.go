package ai

import (
	"encoding/json"
	"strings"

	"github.com/shopspring/decimal"
	"github.com/tidwall/gjson"
	"gorm.io/datatypes"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
)

// 时间格式（对齐旧 yyyy-MM-dd HH:mm:ss）。
const dateTimeLayout = "2006-01-02 15:04:05"

// ===== VO 转换 =====

// toTaskVO 任务转 VO（modelName 由调用方传入；空则不查）。
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

// toTaskVOWithModel 单任务转 VO 并补 modelName（按 model 主键查名）。
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

// toTaskVOList 批量任务转 VO，批量回填 modelName（避免 N+1）。
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

// toModelVO 模型转 VO（providerName 由调用方按需填）。
func toModelVO(m *model.AiModel, providerName string) ModelVO {
	vo := ModelVO{
		ID:                m.PublicID,
		Name:              m.Name,
		Icon:              m.Icon,
		ModelID:           m.ModelID,
		Type:              m.Type,
		SupportedHandlers: parseSupportedHandlers(m.SupportedHandlers),
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

// toHandlerVO Handler 配置转 VO。
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

// toProviderVO 供应商转 VO（apiKey 脱敏，对齐 listProviders）。
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

// toLogVO 生成/操作日志转 VO（不含关联回填，由 admin/service 调用方批量 enrich）。
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

// parseSupportedHandlers JSON 数组 → []string；空/解析失败返回 nil（语义「不限制」），对齐 parseSupportedHandlers。
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

// ===== 计费辅助 =====

// pricingFromConfig 从模型 config.pricing 矩阵按 input 维度取单价（对齐 pricingFromConfig）。
// video：行=resolution 列=duration；其余：行=quality 列=clarity。命中数值返回 (price, true)。
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

// escapeKey 转义 gjson 路径中的特殊字符（如比例键 "16:9" 不含特殊符，但 duration "5s" 安全；点号需转义）。
func escapeKey(k string) string {
	return strings.ReplaceAll(k, ".", `\.`)
}

// ===== 小工具 =====

// toJSON map → datatypes.JSON（失败回退 {}，对齐 inputParams 容错）。
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

// containsInt64 列表是否含某值。
func containsInt64(list []int64, v int64) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

// intFromDecimal decimal → int（截断，对齐 cost.intValue()）。
func intFromDecimal(d decimal.Decimal) int {
	return int(d.IntPart())
}

// truncate 截断超长字符串（日志 body 留存，对齐 GenerationLogRecorder.truncate）。
func truncate(s string, max int) string {
	if len(s) > max {
		return s[:max] + "...[truncated]"
	}
	return s
}

// boolToInt 布尔 → 1/0（success 列）。
func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// blankNil 空白 → ""（库列允许空；保持与旧 hasText ? v : null 语义一致，Go 侧空串即可）。
func blankNil(s string) string {
	if strings.TrimSpace(s) == "" {
		return ""
	}
	return s
}

// isHTTPURL 是否 http(s) 地址（转存前过滤 data: 占位图等）。
func isHTTPURL(s string) bool {
	return strings.HasPrefix(s, "http://") || strings.HasPrefix(s, "https://")
}

// ===== 任务进度回写（替代 RunwareClient.updateTaskProgress 的 ThreadLocal 取 taskId）=====

// taskProgress 实现 progressReporter：把 Runware 轮询进度 CAS 回写到对应任务（仅处理中生效）。
type taskProgress struct {
	repo   *Repository
	taskID int64
}

// report 回写进度（失败静默，不影响生成）。
func (p *taskProgress) report(progress int) {
	if p == nil || p.repo == nil {
		return
	}
	_ = p.repo.UpdateProgressIfProcessing(p.taskID, progress)
}
