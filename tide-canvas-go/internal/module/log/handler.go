package log

import (
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/tidecanvas/tide-canvas-go/internal/middleware"
	"github.com/tidecanvas/tide-canvas-go/pkg/ecode"
	appjwt "github.com/tidecanvas/tide-canvas-go/pkg/jwt"
	"github.com/tidecanvas/tide-canvas-go/pkg/response"
)

// Handler 日志模块 HTTP 层（管理端日志查询/删除 + 访问统计），统一挂载于 /api/admin/logs/*。
type Handler struct {
	svc *Service
}

// NewHandler 构造。
func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// RegisterRoutes 注册日志管理路由（传入 /api 组 → 实际 /api/admin/logs/*）。
//
// 校验链：JWTAuth（注入当前用户）→ AdminOnly（限管理员）→ RequiresPermission(code)（按钮级权限码）。
// 各接口的权限码忠实迁移旧 AdminAccessLogController / AdminLoginLogController / AdminLogController
// 上的 @RequiresPermission。permLoader 由 router 注入一次后在全部路由复用（middleware.NewDBPermissionLoader(db)）。
func (h *Handler) RegisterRoutes(api gin.IRouter, jwtProvider *appjwt.Provider, permLoader middleware.PermissionLoader) {
	logs := api.Group("/admin/logs")
	logs.Use(middleware.JWTAuth(jwtProvider), middleware.AdminOnly())

	// 访问日志 /api/admin/logs/access
	logs.GET("/access", middleware.RequiresPermission(permLoader, "accesslog:view"), h.listAccessLogs)
	logs.DELETE("/access/:id", middleware.RequiresPermission(permLoader, "accesslog:delete"), h.deleteAccessLog)

	// 登录日志 /api/admin/logs/login
	logs.GET("/login", middleware.RequiresPermission(permLoader, "loginlog:view"), h.listLoginLogs)
	logs.DELETE("/login/:id", middleware.RequiresPermission(permLoader, "loginlog:delete"), h.deleteLoginLog)

	// 操作日志 /api/admin/logs/operation（sys_log）
	logs.GET("/operation", middleware.RequiresPermission(permLoader, "syslog:view"), h.listSysLogs)
	logs.DELETE("/operation/:id", middleware.RequiresPermission(permLoader, "syslog:delete"), h.deleteSysLog)

	// 访问统计（PV/UV/登录） /api/admin/logs/stats（沿用访问日志查看权限）
	logs.GET("/stats", middleware.RequiresPermission(permLoader, "accesslog:view"), h.stats)
}

// listAccessLogs GET /api/admin/logs/access 访问日志分页（权限码 accesslog:view）。
func (h *Handler) listAccessLogs(c *gin.Context) {
	var q AccessLogQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	records, total, err := h.svc.ListAccessLogs(&q)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, response.Page(records, total, q.PageNum, q.PageSize))
}

// deleteAccessLog DELETE /api/admin/logs/access/:id 删除访问日志（权限码 accesslog:delete）。
func (h *Handler) deleteAccessLog(c *gin.Context) {
	id, ok := parseInt64Param(c.Param("id"))
	if !ok {
		response.Fail(c, ecode.BadRequest)
		return
	}
	if err := h.svc.DeleteAccessLog(id); err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, nil)
}

// listLoginLogs GET /api/admin/logs/login 登录日志分页（权限码 loginlog:view）。
func (h *Handler) listLoginLogs(c *gin.Context) {
	var q LoginLogQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	records, total, err := h.svc.ListLoginLogs(&q)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, response.Page(records, total, q.PageNum, q.PageSize))
}

// deleteLoginLog DELETE /api/admin/logs/login/:id 删除登录日志（权限码 loginlog:delete）。
func (h *Handler) deleteLoginLog(c *gin.Context) {
	id, ok := parseInt64Param(c.Param("id"))
	if !ok {
		response.Fail(c, ecode.BadRequest)
		return
	}
	if err := h.svc.DeleteLoginLog(id); err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, nil)
}

// listSysLogs GET /api/admin/logs/operation 操作日志分页（权限码 syslog:view）。
func (h *Handler) listSysLogs(c *gin.Context) {
	var q SysLogQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	records, total, err := h.svc.ListSysLogs(&q)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, response.Page(records, total, q.PageNum, q.PageSize))
}

// deleteSysLog DELETE /api/admin/logs/operation/:id 删除操作日志（权限码 syslog:delete）。
func (h *Handler) deleteSysLog(c *gin.Context) {
	id, ok := parseInt64Param(c.Param("id"))
	if !ok {
		response.Fail(c, ecode.BadRequest)
		return
	}
	if err := h.svc.DeleteSysLog(id); err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, nil)
}

// stats GET /api/admin/logs/stats 访问统计（今日 PV/UV/登录 + 近7天趋势；权限码 accesslog:view）。
func (h *Handler) stats(c *gin.Context) {
	response.OK(c, h.svc.Stats())
}

// parseInt64Param 解析 int64 路径参数（日志按数值主键定位，无 public_id）。
func parseInt64Param(s string) (int64, bool) {
	if s == "" {
		return 0, false
	}
	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return 0, false
	}
	return n, true
}
