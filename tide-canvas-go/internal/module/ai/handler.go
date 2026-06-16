package ai

import (
	"time"

	"github.com/gin-gonic/gin"

	"github.com/tidecanvas/tide-canvas-go/internal/middleware"
	"github.com/tidecanvas/tide-canvas-go/pkg/ecode"
	"github.com/tidecanvas/tide-canvas-go/pkg/response"
	appjwt "github.com/tidecanvas/tide-canvas-go/pkg/jwt"
)

// Handler AI 用户侧 HTTP 层（挂载 /api/ai/*，全部需登录）。
// 管理端 CRUD 见 admin.go（/api/admin/ai/*，AdminOnly）。
type Handler struct {
	svc     *Service
	admin   *AdminService
	storage GridStorage
}

// NewHandler 构造 AI Handler。
//
// 依赖：
//   - svc      AI 生成服务。
//   - admin    管理端服务（provider/model/handler CRUD + 日志）。
//   - storage  宫格切分用存储后端（router 注入 file 模块实现；nil 时 grid-split 返回 500 提示）。
func NewHandler(svc *Service, admin *AdminService, storage GridStorage) *Handler {
	return &Handler{svc: svc, admin: admin, storage: storage}
}

// RegisterRoutes 注册用户侧 + 管理端路由到给定父组（传入 /api 组）。
//
// 用户侧 /api/ai/*：JWTAuth。管理端 /api/admin/ai/*：JWTAuth + AdminOnly + RequiresPermission(ai:view / ai:manage)。
// permLoader 透传给管理端 RegisterRoutes 用于按钮级权限校验（middleware.NewDBPermissionLoader(db)）。
func (h *Handler) RegisterRoutes(api gin.IRouter, jwtProvider *appjwt.Provider, permLoader middleware.PermissionLoader) {
	// ---- 用户侧 /api/ai ----
	ai := api.Group("/ai")
	ai.Use(middleware.JWTAuth(jwtProvider))
	// AI 生成为最贵操作：按 用户+IP 维度限流（对齐旧 @RateLimit(ai_generate, 30/60s)）。
	ai.POST("/generate", middleware.RateLimit(middleware.RateLimitOptions{
		Name: "ai_generate", Limit: 30, Period: 60 * time.Second, Dimension: middleware.DimUserAndIP, BanThreshold: 5, BanSeconds: 1800,
	}), h.generate)
	ai.POST("/grid-split", h.gridSplit)
	ai.GET("/tasks/:id", h.getTask)
	ai.DELETE("/tasks/:id", h.cancelTask)
	ai.GET("/tasks", h.listTasks)
	ai.GET("/models", h.listModels)
	ai.GET("/handlers", h.listHandlers)
	ai.GET("/logs", h.myLogs)

	// ---- 管理端 /api/admin/ai ----
	h.admin.RegisterRoutes(api, jwtProvider, permLoader)
}

// generate POST /api/ai/generate 统一生成入口（已挂限流，对齐旧 @RateLimit(ai_generate, 30/60s)）。
func (h *Handler) generate(c *gin.Context) {
	var dto GenerateDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	if !hasText(dto.Handler) {
		response.Fail(c, ecode.BadRequest.WithMessage("handler不能为空"))
		return
	}
	if !hasText(dto.ModelID) {
		response.Fail(c, ecode.BadRequest.WithMessage("模型ID不能为空"))
		return
	}
	if dto.Input == nil {
		response.Fail(c, ecode.BadRequest.WithMessage("输入参数不能为空"))
		return
	}
	vo, err := h.svc.Generate(middleware.MustUserID(c), &dto)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vo)
}

// gridSplit POST /api/ai/grid-split 图片宫格切分。
func (h *Handler) gridSplit(c *gin.Context) {
	var dto GridSplitDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	if !hasText(dto.ImageURL) {
		response.Fail(c, ecode.BadRequest.WithMessage("图片地址不能为空"))
		return
	}
	if dto.Rows < 1 || dto.Rows > 10 || dto.Cols < 1 || dto.Cols > 10 {
		response.Fail(c, ecode.BadRequest.WithMessage("行/列数需在 1~10 之间"))
		return
	}
	urls, err := h.svc.GridSplit(h.storage, &dto)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, urls)
}

// getTask GET /api/ai/tasks/:id 查询任务状态（:id 为任务 public_id，前端轮询）。
func (h *Handler) getTask(c *gin.Context) {
	vo, err := h.svc.GetTask(middleware.MustUserID(c), c.Param("id"))
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vo)
}

// cancelTask DELETE /api/ai/tasks/:id 取消任务（:id 为任务 public_id）。
func (h *Handler) cancelTask(c *gin.Context) {
	if err := h.svc.CancelTask(middleware.MustUserID(c), c.Param("id")); err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, nil)
}

// listTasks GET /api/ai/tasks 我的任务列表（团队共享）。
func (h *Handler) listTasks(c *gin.Context) {
	var q TaskQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	records, total, err := h.svc.ListTasks(middleware.MustUserID(c), &q)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, response.Page(records, total, q.PageNum, q.PageSize))
}

// listModels GET /api/ai/models 可用模型列表（用户侧脱敏成本）。
func (h *Handler) listModels(c *gin.Context) {
	vos, err := h.svc.ListModels()
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vos)
}

// listHandlers GET /api/ai/handlers 可用 Handler 列表。
func (h *Handler) listHandlers(c *gin.Context) {
	vos, err := h.svc.ListHandlers()
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vos)
}

// myLogs GET /api/ai/logs 本画布生成历史（当前用户，团队共享，可按 projectId 过滤）。
func (h *Handler) myLogs(c *gin.Context) {
	var q PageQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	records, total, err := h.svc.MyLogs(middleware.MustUserID(c), c.Query("projectId"), &q)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, response.Page(records, total, q.PageNum, q.PageSize))
}
