package ai

import (
	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
	"github.com/sirupsen/logrus"

	"github.com/tidecanvas/tide-canvas-go/internal/middleware"
	"github.com/tidecanvas/tide-canvas-go/internal/model"
	"github.com/tidecanvas/tide-canvas-go/pkg/ecode"
	appjwt "github.com/tidecanvas/tide-canvas-go/pkg/jwt"
	"github.com/tidecanvas/tide-canvas-go/pkg/response"
)

// AdminService AI 管理端服务（忠实迁移 AdminAiController）：供应商/模型/Handler CRUD + 操作日志。
// 校验链：JWTAuth → AdminOnly → RequiresPermission(code)（按钮级权限码）：
// 只读 GET 用 "ai:view"，增删改（POST/PUT/DELETE）用 "ai:manage"。
type AdminService struct {
	repo    *Repository
	gateway *Gateway
	user    UserFinder
	logger  *logrus.Logger
}

// NewAdminService 构造。gateway 复用生成服务的网关（含 Runware 客户端，供 modelSearch）。
func NewAdminService(repo *Repository, gateway *Gateway, user UserFinder, logger *logrus.Logger) *AdminService {
	return &AdminService{repo: repo, gateway: gateway, user: user, logger: logger}
}

// RegisterRoutes 注册管理端路由 /api/admin/ai/*。
//
// 校验链：JWTAuth（注入当前用户）→ AdminOnly（限管理员）→ RequiresPermission(code)（按钮级权限码）：
// 只读 GET 用 "ai:view"，增删改（POST/PUT/DELETE）用 "ai:manage"。
// permLoader 由 router 注入一次后在全部路由复用（middleware.NewDBPermissionLoader(db)）。
func (s *AdminService) RegisterRoutes(api gin.IRouter, jwtProvider *appjwt.Provider, permLoader middleware.PermissionLoader) {
	g := api.Group("/admin/ai")
	g.Use(middleware.JWTAuth(jwtProvider), middleware.AdminOnly())

	// Provider
	g.GET("/providers", middleware.RequiresPermission(permLoader, "provider:view"), s.listProviders)
	g.POST("/providers", middleware.RequiresPermission(permLoader, "provider:manage"), s.createProvider)
	g.GET("/providers/:id/models", middleware.RequiresPermission(permLoader, "provider:view"), s.listRemoteModels)
	g.PUT("/providers/:id", middleware.RequiresPermission(permLoader, "provider:manage"), s.updateProvider)
	g.DELETE("/providers/:id", middleware.RequiresPermission(permLoader, "provider:manage"), s.deleteProvider)

	// Model
	g.GET("/models", middleware.RequiresPermission(permLoader, "model:view"), s.listModels)
	g.POST("/models", middleware.RequiresPermission(permLoader, "model:manage"), s.createModel)
	g.PUT("/models/:id", middleware.RequiresPermission(permLoader, "model:manage"), s.updateModel)
	g.DELETE("/models/:id", middleware.RequiresPermission(permLoader, "model:manage"), s.deleteModel)

	// Production model routing
	g.GET("/upstream-models", middleware.RequiresPermission(permLoader, "model:view"), s.listUpstreamModels)
	g.POST("/upstream-models", middleware.RequiresPermission(permLoader, "model:manage"), s.createUpstreamModel)
	g.PUT("/upstream-models/:id", middleware.RequiresPermission(permLoader, "model:manage"), s.updateUpstreamModel)
	g.DELETE("/upstream-models/:id", middleware.RequiresPermission(permLoader, "model:manage"), s.deleteUpstreamModel)
	g.GET("/models/:id/routes", middleware.RequiresPermission(permLoader, "model:view"), s.listModelRoutes)
	g.POST("/models/:id/routes", middleware.RequiresPermission(permLoader, "model:manage"), s.createModelRoute)
	g.PUT("/routes/:id", middleware.RequiresPermission(permLoader, "model:manage"), s.updateModelRoute)
	g.DELETE("/routes/:id", middleware.RequiresPermission(permLoader, "model:manage"), s.deleteModelRoute)
	g.GET("/route-decisions", middleware.RequiresPermission(permLoader, "ailog:view"), s.listRouteDecisionLogs)

	// Handler
	g.GET("/handlers", middleware.RequiresPermission(permLoader, "handler:view"), s.listHandlers)
	g.PUT("/handlers/:name", middleware.RequiresPermission(permLoader, "handler:manage"), s.updateHandler)

	// 生成 / 操作日志
	g.GET("/logs", middleware.RequiresPermission(permLoader, "ailog:view"), s.listLogs)
	g.GET("/logs/cost-sum", middleware.RequiresPermission(permLoader, "ailog:view"), s.logsCostSum)
	g.GET("/logs/:id", middleware.RequiresPermission(permLoader, "ailog:view"), s.getLog)
}

// =====================================================================
// Provider
// =====================================================================

// listProviders GET /providers 供应商列表（apiKey 脱敏，对齐 listProviders）。
func (s *AdminService) listProviders(c *gin.Context) {
	list, err := s.repo.ListProvidersByPriority()
	if err != nil {
		response.FailErr(c, err)
		return
	}
	out := make([]ProviderVO, 0, len(list))
	for i := range list {
		out = append(out, toProviderVO(&list[i]))
	}
	response.OK(c, out)
}

// createProvider POST /providers 新增供应商（对齐 createProvider）。
func (s *AdminService) createProvider(c *gin.Context) {
	var body map[string]interface{}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	p := &model.AiProvider{
		Name:         strOf(body["name"]),
		ProviderType: strOf(body["providerType"]),
		APIKey:       strOf(body["apiKey"]),
		BaseURL:      strOf(body["baseUrl"]),
		Status:       1,
		Priority:     intOrDefault(body["priority"], 0),
		RateLimit:    intOrDefault(body["rateLimit"], 60),
	}
	if err := s.repo.CreateProvider(p); err != nil {
		response.FailErr(c, err)
		return
	}
	// 新建返回明文 key（对齐旧 createProvider 未脱敏；前端创建后即用）
	vo := toProviderVO(p)
	vo.APIKey = p.APIKey
	response.OK(c, vo)
}

// listRemoteModels GET /providers/:id/models 从供应商拉取可用模型列表
// （runware 走 modelSearch；其余走 OpenAI 风格 /models）。对齐 listRemoteModels。
func (s *AdminService) listRemoteModels(c *gin.Context) {
	id, ok := parseInt64(c.Param("id"))
	if !ok {
		response.Fail(c, ecode.BadRequest)
		return
	}
	provider, err := s.repo.FindProviderByID(id)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	if provider == nil {
		response.Fail(c, ecode.NotFound)
		return
	}
	if !hasText(provider.BaseURL) || !hasText(provider.APIKey) {
		response.Fail(c, ecode.BadRequest.WithMessage("供应商未配置 baseUrl 或 apiKey"))
		return
	}
	models, err := s.gateway.listRemoteModels(provider, c.Query("search"))
	if err != nil {
		response.FailErr(c, ecode.ServerError.WithMessage("拉取模型失败："+err.Error()))
		return
	}
	response.OK(c, models)
}

// updateProvider PUT /providers/:id 更新供应商（对齐 updateProvider，仅传入字段更新）。
func (s *AdminService) updateProvider(c *gin.Context) {
	id, ok := parseInt64(c.Param("id"))
	if !ok {
		response.Fail(c, ecode.BadRequest)
		return
	}
	provider, err := s.repo.FindProviderByID(id)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	if provider == nil {
		response.Fail(c, ecode.NotFound)
		return
	}
	var body map[string]interface{}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	columns := map[string]interface{}{}
	setIfPresent(body, "name", columns, "name", asString)
	setIfPresent(body, "providerType", columns, "provider_type", asString)
	setIfPresent(body, "apiKey", columns, "api_key", asString)
	setIfPresent(body, "baseUrl", columns, "base_url", asString)
	setIfPresent(body, "status", columns, "status", asInt)
	setIfPresent(body, "priority", columns, "priority", asInt)
	if err := s.repo.UpdateProviderColumns(id, columns); err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, nil)
}

// deleteProvider DELETE /providers/:id 删除供应商（逻辑删除，对齐 deleteProvider）。
func (s *AdminService) deleteProvider(c *gin.Context) {
	id, ok := parseInt64(c.Param("id"))
	if !ok {
		response.Fail(c, ecode.BadRequest)
		return
	}
	if err := s.repo.DeleteProvider(id); err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, nil)
}

// =====================================================================
// Model
// =====================================================================

// listModels GET /models 模型列表（管理端含上游成本 + providerName，对齐 listModels）。
func (s *AdminService) listModels(c *gin.Context) {
	list, err := s.repo.ListAllModels()
	if err != nil {
		response.FailErr(c, err)
		return
	}
	providerNames, err := s.repo.ProviderNames()
	if err != nil {
		response.FailErr(c, err)
		return
	}
	out := make([]ModelVO, 0, len(list))
	for i := range list {
		name := ""
		if list[i].ProviderID != 0 {
			name = providerNames[list[i].ProviderID]
		}
		out = append(out, toModelVO(&list[i], name))
	}
	response.OK(c, out)
}

// createModel POST /models 新增模型（对齐 createModel）。
func (s *AdminService) createModel(c *gin.Context) {
	var body map[string]interface{}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	providerID, ok := asInt64(body["providerId"])
	if !ok {
		response.Fail(c, ecode.BadRequest.WithMessage("providerId不能为空"))
		return
	}
	m := &model.AiModel{
		ProviderID: providerID,
		Name:       strOf(body["name"]),
		ModelID:    strOf(body["modelId"]),
		Type:       strOf(body["type"]),
		Status:     1,
	}
	if v, ok := body["icon"]; ok {
		m.Icon = strOf(v)
	}
	if v, ok := body["config"]; ok && v != nil {
		m.Config = jsonColumn(v)
	}
	if v, ok := body["pointCost"]; ok {
		if d, ok := asDecimal(v); ok {
			m.PointCost = d
		}
	}
	if v, ok := body["costPerCall"]; ok && v != nil {
		if d, ok := asDecimal(v); ok {
			m.CostPerCall = d
		}
	}
	if v, ok := body["supportedHandlers"]; ok {
		m.SupportedHandlers = supportedHandlersJSON(v)
	}
	if err := s.repo.CreateModel(m); err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, toModelVO(m, ""))
}

func (s *AdminService) findModelByRouteID(raw string) (*model.AiModel, error) {
	if id, ok := parseInt64(raw); ok {
		return s.repo.FindModelByID(id)
	}
	if !hasText(raw) {
		return nil, nil
	}
	return s.repo.FindModelByPublicID(raw)
}

// updateModel PUT /models/:id 更新模型（对齐 updateModel；supportedHandlers 单独写以支持落 NULL）。
func (s *AdminService) updateModel(c *gin.Context) {
	m, err := s.findModelByRouteID(c.Param("id"))
	if err != nil {
		response.FailErr(c, err)
		return
	}
	if m == nil {
		response.Fail(c, ecode.NotFound)
		return
	}
	var body map[string]interface{}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	columns := map[string]interface{}{}
	setIfPresent(body, "name", columns, "name", asString)
	setIfPresent(body, "modelId", columns, "model_id", asString)
	setIfPresent(body, "type", columns, "type", asString)
	setIfPresent(body, "icon", columns, "icon", asString)
	if v, ok := body["config"]; ok && v != nil {
		columns["config"] = jsonColumn(v)
	}
	if v, ok := body["pointCost"]; ok {
		if d, ok := asDecimal(v); ok {
			columns["point_cost"] = d
		}
	}
	if v, ok := body["costPerCall"]; ok && v != nil {
		if d, ok := asDecimal(v); ok {
			columns["cost_per_call"] = d
		}
	}
	if v, ok := body["providerId"]; ok {
		if pid, ok := asInt64(v); ok {
			columns["provider_id"] = pid
		}
	}
	setIfPresent(body, "status", columns, "status", asInt)
	// supported_handlers：空列表/缺省落 NULL（语义「不限制」），单独写入。
	if v, ok := body["supportedHandlers"]; ok {
		j := supportedHandlersJSON(v)
		if len(j) == 0 {
			columns["supported_handlers"] = nil
		} else {
			columns["supported_handlers"] = j
		}
	}
	if err := s.repo.UpdateModelColumns(m.ID, columns); err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, nil)
}

// deleteModel DELETE /models/:id 删除模型（逻辑删除）。
func (s *AdminService) deleteModel(c *gin.Context) {
	m, err := s.findModelByRouteID(c.Param("id"))
	if err != nil {
		response.FailErr(c, err)
		return
	}
	if m == nil {
		response.Fail(c, ecode.NotFound)
		return
	}
	if err := s.repo.DeleteModel(m.ID); err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, nil)
}

// =====================================================================
// Handler 配置
// =====================================================================

// listHandlers GET /handlers Handler 列表（全部，按 sort_order，对齐 listHandlers）。
func (s *AdminService) listHandlers(c *gin.Context) {
	list, err := s.repo.ListAllHandlers()
	if err != nil {
		response.FailErr(c, err)
		return
	}
	out := make([]HandlerVO, 0, len(list))
	for i := range list {
		out = append(out, toHandlerVO(&list[i]))
	}
	response.OK(c, out)
}

// updateHandler PUT /handlers/:name 更新 Handler 配置（对齐 updateHandler）。
func (s *AdminService) updateHandler(c *gin.Context) {
	name := c.Param("name")
	config, err := s.repo.FindHandlerConfig(name)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	if config == nil {
		response.Fail(c, ecode.HandlerNotFound)
		return
	}
	var body map[string]interface{}
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	columns := map[string]interface{}{}
	setIfPresent(body, "status", columns, "status", asInt)
	if v, ok := body["defaultModelId"]; ok {
		if id, ok := asInt64(v); ok {
			columns["default_model_id"] = id
		}
	}
	if v, ok := body["pointCost"]; ok {
		if d, ok := asDecimal(v); ok {
			columns["point_cost"] = d
		}
	}
	if err := s.repo.UpdateHandlerColumns(name, columns); err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, nil)
}

// =====================================================================
// 生成 / 操作日志
// =====================================================================

// listLogs GET /logs 操作日志列表（按筛选条件分页 + 关联回填，对齐 listLogs）。
func (s *AdminService) listLogs(c *gin.Context) {
	var q GenerationLogQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	q.normalize()
	records, total, err := s.repo.PageLogsAdmin(&q)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	vos := make([]GenerationLogVO, 0, len(records))
	for i := range records {
		vos = append(vos, toLogVO(&records[i]))
	}
	if err := s.enrich(vos); err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, response.Page(vos, total, q.PageNum, q.PageSize))
}

// logsCostSum GET /logs/cost-sum 操作日志上游成本汇总（USD，按当前筛选，对齐 logsCostSum）。
func (s *AdminService) logsCostSum(c *gin.Context) {
	var q GenerationLogQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	sum, err := s.repo.SumLogsCost(&q)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	d, derr := decimal.NewFromString(sum)
	if derr != nil {
		d = decimal.Zero
	}
	response.OK(c, d)
}

// getLog GET /logs/:id 操作日志详情（回填用户输入参数对照排查，对齐 getLog）。
func (s *AdminService) getLog(c *gin.Context) {
	id, ok := parseInt64(c.Param("id"))
	if !ok {
		response.Fail(c, ecode.BadRequest)
		return
	}
	logDO, err := s.repo.FindLogByID(id)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	if logDO == nil {
		response.Fail(c, ecode.NotFound)
		return
	}
	vo := toLogVO(logDO)
	single := []GenerationLogVO{vo}
	if err := s.enrich(single); err != nil {
		response.FailErr(c, err)
		return
	}
	vo = single[0]
	// 回填用户输入参数（取自 ai_task.input_params）
	if logDO.TaskID != nil {
		if params, err := s.repo.TaskInputParams(*logDO.TaskID); err == nil {
			vo.InputParams = params
		}
	}
	response.OK(c, vo)
}

// enrich 批量回填关联展示字段（用户名 / 画布名 / 任务状态），按本页 id 集合一次性查询避免 N+1
// （对齐 AdminAiController.enrich）。
func (s *AdminService) enrich(list []GenerationLogVO) error {
	if len(list) == 0 {
		return nil
	}
	userIDs := make([]int64, 0, len(list))
	projectIDs := make([]int64, 0, len(list))
	taskIDs := make([]int64, 0, len(list))
	for i := range list {
		if list[i].UserID != nil {
			userIDs = appendUniq(userIDs, *list[i].UserID)
		}
		if list[i].ProjectID != nil {
			projectIDs = appendUniq(projectIDs, *list[i].ProjectID)
		}
		if list[i].TaskID != nil {
			taskIDs = appendUniq(taskIDs, *list[i].TaskID)
		}
	}
	userNames := map[int64]string{}
	if s.user != nil {
		var err error
		if userNames, err = s.user.UsernamesByIDs(userIDs); err != nil {
			return err
		}
	}
	projectNames, err := s.repo.ProjectNames(projectIDs)
	if err != nil {
		return err
	}
	taskStatuses, err := s.repo.TaskStatuses(taskIDs)
	if err != nil {
		return err
	}
	for i := range list {
		if list[i].UserID != nil {
			list[i].UserName = userNames[*list[i].UserID]
		}
		if list[i].ProjectID != nil {
			list[i].ProjectName = projectNames[*list[i].ProjectID]
		}
		if list[i].TaskID != nil {
			if st, ok := taskStatuses[*list[i].TaskID]; ok {
				v := st
				list[i].TaskStatus = &v
			}
		}
	}
	return nil
}

// listRemoteModels 网关方法：runware 走 modelSearch（AIR 列表）；其余走 OpenAI 风格 /models。
// 放在 Gateway 上以复用 runware 客户端（对齐 AdminAiController.listRemoteModels）。
func (g *Gateway) listRemoteModels(provider *model.AiProvider, search string) ([]string, error) {
	if isRunware(provider) {
		return g.runware.searchModels(provider, search)
	}
	return g.relay.listOpenAIModels(provider)
}
