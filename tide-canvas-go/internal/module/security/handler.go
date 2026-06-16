package security

import (
	"github.com/gin-gonic/gin"

	"github.com/tidecanvas/tide-canvas-go/internal/middleware"
	"github.com/tidecanvas/tide-canvas-go/pkg/ecode"
	appjwt "github.com/tidecanvas/tide-canvas-go/pkg/jwt"
	"github.com/tidecanvas/tide-canvas-go/pkg/response"
)

// Handler 安全封禁模块 HTTP 层，统一挂载于 /api/admin/security/*（对齐前端 adminApi.security）。
type Handler struct {
	svc *Service
}

// NewHandler 构造。limiter 须为与限流中间件相同的 Limiter 实例（router 注入）。
func NewHandler(limiter middleware.Limiter) *Handler {
	return &Handler{svc: NewService(limiter)}
}

// RegisterRoutes 注册安全封禁路由（传入 /api 组 → 实际 /api/admin/security/*）。
//
// 校验链：JWTAuth → AdminOnly → RequiresPermission（查看 security:view / 封禁解封 security:manage）。
func (h *Handler) RegisterRoutes(api gin.IRouter, jwtProvider *appjwt.Provider, permLoader middleware.PermissionLoader) {
	g := api.Group("/admin/security")
	g.Use(middleware.JWTAuth(jwtProvider), middleware.AdminOnly())
	g.GET("/bans", middleware.RequiresPermission(permLoader, "security:view"), h.listBans)
	g.POST("/ban", middleware.RequiresPermission(permLoader, "security:manage"), h.ban)
	g.POST("/unban", middleware.RequiresPermission(permLoader, "security:manage"), h.unban)
}

// listBans GET /api/admin/security/bans 当前所有封禁列表（权限码 security:view）。
func (h *Handler) listBans(c *gin.Context) {
	response.OK(c, h.svc.ListBans())
}

// ban POST /api/admin/security/ban 手动封禁用户/IP（权限码 security:manage）。
func (h *Handler) ban(c *gin.Context) {
	var req BanReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	if !h.svc.Ban(&req) {
		response.FailWith(c, ecode.BadRequest, "封禁参数无效：type 须为 user/ip 且 value 非空")
		return
	}
	response.OK(c, nil)
}

// unban POST /api/admin/security/unban 解除封禁（权限码 security:manage），入参 { actor }。
func (h *Handler) unban(c *gin.Context) {
	var req UnbanReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	h.svc.Unban(req.Actor)
	response.OK(c, nil)
}
