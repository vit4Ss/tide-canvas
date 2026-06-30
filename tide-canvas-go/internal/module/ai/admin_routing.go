package ai

import (
	"errors"

	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
	"github.com/tidecanvas/tide-canvas-go/pkg/ecode"
	"github.com/tidecanvas/tide-canvas-go/pkg/response"
)

type UpstreamModelVO struct {
	ID           int64           `json:"id,string"`
	ProviderID   int64           `json:"providerId,string"`
	ProviderName string          `json:"providerName"`
	Name         string          `json:"name"`
	ModelID      string          `json:"modelId"`
	Type         string          `json:"type"`
	Capabilities string          `json:"capabilities"`
	Config       string          `json:"config"`
	CostPerCall  decimal.Decimal `json:"costPerCall"`
	TimeoutMs    int             `json:"timeoutMs"`
	Priority     int             `json:"priority"`
	Status       int             `json:"status"`
	CreateTime   string          `json:"createTime"`
}

type ModelRouteVO struct {
	ID                int64  `json:"id,string"`
	LogicalModelID    int64  `json:"logicalModelId,string"`
	LogicalModelName  string `json:"logicalModelName"`
	UpstreamModelID   int64  `json:"upstreamModelId,string"`
	UpstreamModelName string `json:"upstreamModelName"`
	HandlerName       string `json:"handlerName"`
	RouteStrategy     string `json:"routeStrategy"`
	ComplexityLevel   string `json:"complexityLevel"`
	Conditions        string `json:"conditions"`
	Priority          int    `json:"priority"`
	Weight            int    `json:"weight"`
	Status            int    `json:"status"`
	CreateTime        string `json:"createTime"`
}

type RouteDecisionLogVO struct {
	ID               int64  `json:"id,string"`
	TaskID           *int64 `json:"taskId,string"`
	UserID           *int64 `json:"userId,string"`
	LogicalModelID   *int64 `json:"logicalModelId,string"`
	UpstreamModelID  *int64 `json:"upstreamModelId,string"`
	ProviderID       *int64 `json:"providerId,string"`
	RouteID          *int64 `json:"routeId,string"`
	HandlerName      string `json:"handlerName"`
	RouteStrategy    string `json:"routeStrategy"`
	LogicalModel     string `json:"logicalModel"`
	UpstreamModel    string `json:"upstreamModel"`
	ComplexityLevel  string `json:"complexityLevel"`
	ComplexityScore  int    `json:"complexityScore"`
	DecisionReason   string `json:"decisionReason"`
	CandidateCount   int    `json:"candidateCount"`
	FallbackUsed     int    `json:"fallbackUsed"`
	DecisionMetadata string `json:"decisionMetadata"`
	CreateTime       string `json:"createTime"`
}

func (r *Repository) PageRouteDecisionLogs(q *PageQuery) ([]model.AiRouteDecisionLog, int64, error) {
	var total int64
	base := r.db.Model(&model.AiRouteDecisionLog{})
	if err := base.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var records []model.AiRouteDecisionLog
	err := base.Order("id DESC").Offset(q.Offset()).Limit(q.PageSize).Find(&records).Error
	return records, total, err
}

func (s *AdminService) listUpstreamModels(c *gin.Context) {
	list, err := s.repo.ListUpstreamModels()
	if err != nil {
		response.FailErr(c, err)
		return
	}
	providerNames, err := s.repo.ProviderNames()
	if err != nil {
		response.FailErr(c, err)
		return
	}
	out := make([]UpstreamModelVO, 0, len(list))
	for i := range list {
		out = append(out, toUpstreamModelVO(&list[i], providerNames[list[i].ProviderID]))
	}
	response.OK(c, out)
}

func (s *AdminService) createUpstreamModel(c *gin.Context) {
	var body map[string]interface{}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	providerID, ok := asInt64(body["providerId"])
	if !ok || providerID == 0 || !hasText(strOf(body["modelId"])) {
		response.Fail(c, ecode.BadRequest.WithMessage("providerId and modelId are required"))
		return
	}
	provider, err := s.repo.FindProviderByID(providerID)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	if provider == nil {
		response.Fail(c, ecode.NotFound)
		return
	}
	m := &model.AiUpstreamModel{
		ProviderID: providerID,
		Name:       strOf(body["name"]),
		ModelID:    strOf(body["modelId"]),
		Type:       strOf(body["type"]),
		TimeoutMs:  intOrDefault(body["timeoutMs"], 0),
		Priority:   intOrDefault(body["priority"], 0),
		Status:     intOrDefault(body["status"], 1),
	}
	if !hasText(m.Name) {
		m.Name = m.ModelID
	}
	if v, ok := body["capabilities"]; ok && v != nil {
		m.Capabilities = jsonColumn(v)
	}
	if v, ok := body["config"]; ok && v != nil {
		m.Config = jsonColumn(v)
	}
	if v, ok := body["costPerCall"]; ok && v != nil {
		if d, ok := asDecimal(v); ok {
			m.CostPerCall = d
		}
	}
	if err := s.repo.CreateUpstreamModel(m); err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, toUpstreamModelVO(m, provider.Name))
}

func (s *AdminService) updateUpstreamModel(c *gin.Context) {
	id, ok := parseInt64(c.Param("id"))
	if !ok {
		response.Fail(c, ecode.BadRequest)
		return
	}
	existing, err := s.repo.FindUpstreamModelByID(id)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	if existing == nil {
		response.Fail(c, ecode.NotFound)
		return
	}
	var body map[string]interface{}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	columns := map[string]interface{}{}
	if v, ok := body["providerId"]; ok {
		if providerID, ok := asInt64(v); ok && providerID != 0 {
			columns["provider_id"] = providerID
		}
	}
	setIfPresent(body, "name", columns, "name", asString)
	setIfPresent(body, "modelId", columns, "model_id", asString)
	setIfPresent(body, "type", columns, "type", asString)
	setIfPresent(body, "timeoutMs", columns, "timeout_ms", asInt)
	setIfPresent(body, "priority", columns, "priority", asInt)
	setIfPresent(body, "status", columns, "status", asInt)
	if v, ok := body["capabilities"]; ok && v != nil {
		columns["capabilities"] = jsonColumn(v)
	}
	if v, ok := body["config"]; ok && v != nil {
		columns["config"] = jsonColumn(v)
	}
	if v, ok := body["costPerCall"]; ok && v != nil {
		if d, ok := asDecimal(v); ok {
			columns["cost_per_call"] = d
		}
	}
	if err := s.repo.UpdateUpstreamModelColumns(id, columns); err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, nil)
}

func (s *AdminService) deleteUpstreamModel(c *gin.Context) {
	id, ok := parseInt64(c.Param("id"))
	if !ok {
		response.Fail(c, ecode.BadRequest)
		return
	}
	if err := s.repo.DeleteUpstreamModel(id); err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, nil)
}

func (s *AdminService) listModelRoutes(c *gin.Context) {
	logicalModel, err := s.findModelByRouteID(c.Param("id"))
	if err != nil {
		response.FailErr(c, err)
		return
	}
	if logicalModel == nil {
		response.Fail(c, ecode.NotFound)
		return
	}
	routes, err := s.repo.ListRoutesByLogicalModel(logicalModel.ID)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	upstreamNames, err := s.upstreamNames()
	if err != nil {
		response.FailErr(c, err)
		return
	}
	out := make([]ModelRouteVO, 0, len(routes))
	for i := range routes {
		out = append(out, toModelRouteVO(&routes[i], logicalModel.Name, upstreamNames[routes[i].UpstreamModelID]))
	}
	response.OK(c, out)
}

func (s *AdminService) createModelRoute(c *gin.Context) {
	logicalModel, err := s.findModelByRouteID(c.Param("id"))
	if err != nil {
		response.FailErr(c, err)
		return
	}
	if logicalModel == nil {
		response.Fail(c, ecode.NotFound)
		return
	}
	var body map[string]interface{}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	upstreamID, ok := asInt64(body["upstreamModelId"])
	if !ok || upstreamID == 0 || !hasText(strOf(body["handlerName"])) {
		response.Fail(c, ecode.BadRequest.WithMessage("upstreamModelId and handlerName are required"))
		return
	}
	upstream, err := s.repo.FindUpstreamModelByID(upstreamID)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	if upstream == nil {
		response.Fail(c, ecode.NotFound)
		return
	}
	route := &model.AiModelRoute{
		LogicalModelID:  logicalModel.ID,
		UpstreamModelID: upstreamID,
		HandlerName:     strOf(body["handlerName"]),
		RouteStrategy:   strOf(body["routeStrategy"]),
		ComplexityLevel: strOf(body["complexityLevel"]),
		Priority:        intOrDefault(body["priority"], 0),
		Weight:          intOrDefault(body["weight"], 100),
		Status:          intOrDefault(body["status"], 1),
	}
	if !hasText(route.RouteStrategy) {
		route.RouteStrategy = "priority"
	}
	if v, ok := body["conditions"]; ok && v != nil {
		route.Conditions = jsonColumn(v)
	}
	if err := s.repo.CreateModelRoute(route); err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, toModelRouteVO(route, logicalModel.Name, upstream.Name))
}

func (s *AdminService) updateModelRoute(c *gin.Context) {
	id, ok := parseInt64(c.Param("id"))
	if !ok {
		response.Fail(c, ecode.BadRequest)
		return
	}
	existing, err := s.repo.FindRouteByID(id)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	if existing == nil {
		response.Fail(c, ecode.NotFound)
		return
	}
	var body map[string]interface{}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	columns := map[string]interface{}{}
	if v, ok := body["upstreamModelId"]; ok {
		if upstreamID, ok := asInt64(v); ok && upstreamID != 0 {
			columns["upstream_model_id"] = upstreamID
		}
	}
	setIfPresent(body, "handlerName", columns, "handler_name", asString)
	setIfPresent(body, "routeStrategy", columns, "route_strategy", asString)
	setIfPresent(body, "complexityLevel", columns, "complexity_level", asString)
	setIfPresent(body, "priority", columns, "priority", asInt)
	setIfPresent(body, "weight", columns, "weight", asInt)
	setIfPresent(body, "status", columns, "status", asInt)
	if v, ok := body["conditions"]; ok && v != nil {
		columns["conditions"] = jsonColumn(v)
	}
	if err := s.repo.UpdateModelRouteColumns(id, columns); err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, nil)
}

func (s *AdminService) deleteModelRoute(c *gin.Context) {
	id, ok := parseInt64(c.Param("id"))
	if !ok {
		response.Fail(c, ecode.BadRequest)
		return
	}
	if err := s.repo.DeleteModelRoute(id); err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, nil)
}

func (s *AdminService) listRouteDecisionLogs(c *gin.Context) {
	var q PageQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	q.normalize()
	records, total, err := s.repo.PageRouteDecisionLogs(&q)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	out := make([]RouteDecisionLogVO, 0, len(records))
	for i := range records {
		out = append(out, toRouteDecisionLogVO(&records[i]))
	}
	response.OK(c, response.Page(out, total, q.PageNum, q.PageSize))
}

func (s *AdminService) upstreamNames() (map[int64]string, error) {
	list, err := s.repo.ListUpstreamModels()
	if err != nil {
		return nil, err
	}
	out := make(map[int64]string, len(list))
	for i := range list {
		out[list[i].ID] = list[i].Name
	}
	return out, nil
}

func toUpstreamModelVO(m *model.AiUpstreamModel, providerName string) UpstreamModelVO {
	return UpstreamModelVO{
		ID:           m.ID,
		ProviderID:   m.ProviderID,
		ProviderName: providerName,
		Name:         m.Name,
		ModelID:      m.ModelID,
		Type:         m.Type,
		Capabilities: string(m.Capabilities),
		Config:       string(m.Config),
		CostPerCall:  m.CostPerCall,
		TimeoutMs:    m.TimeoutMs,
		Priority:     m.Priority,
		Status:       m.Status,
		CreateTime:   m.CreateTime.Format(dateTimeLayout),
	}
}

func toModelRouteVO(route *model.AiModelRoute, logicalModelName, upstreamModelName string) ModelRouteVO {
	return ModelRouteVO{
		ID:                route.ID,
		LogicalModelID:    route.LogicalModelID,
		LogicalModelName:  logicalModelName,
		UpstreamModelID:   route.UpstreamModelID,
		UpstreamModelName: upstreamModelName,
		HandlerName:       route.HandlerName,
		RouteStrategy:     route.RouteStrategy,
		ComplexityLevel:   route.ComplexityLevel,
		Conditions:        string(route.Conditions),
		Priority:          route.Priority,
		Weight:            route.Weight,
		Status:            route.Status,
		CreateTime:        route.CreateTime.Format(dateTimeLayout),
	}
}

func toRouteDecisionLogVO(lg *model.AiRouteDecisionLog) RouteDecisionLogVO {
	return RouteDecisionLogVO{
		ID:               lg.ID,
		TaskID:           lg.TaskID,
		UserID:           lg.UserID,
		LogicalModelID:   lg.LogicalModelID,
		UpstreamModelID:  lg.UpstreamModelID,
		ProviderID:       lg.ProviderID,
		RouteID:          lg.RouteID,
		HandlerName:      lg.HandlerName,
		RouteStrategy:    lg.RouteStrategy,
		LogicalModel:     lg.LogicalModel,
		UpstreamModel:    lg.UpstreamModel,
		ComplexityLevel:  lg.ComplexityLevel,
		ComplexityScore:  lg.ComplexityScore,
		DecisionReason:   lg.DecisionReason,
		CandidateCount:   lg.CandidateCount,
		FallbackUsed:     lg.FallbackUsed,
		DecisionMetadata: string(lg.DecisionMetadata),
		CreateTime:       lg.CreateTime.Format(dateTimeLayout),
	}
}

func (r *Repository) EnsureRouteRecordExists(routeID int64) error {
	var route model.AiModelRoute
	err := r.db.First(&route, routeID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return ecode.NotFound
	}
	return err
}
