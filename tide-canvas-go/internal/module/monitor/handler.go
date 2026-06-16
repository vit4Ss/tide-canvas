package monitor

import (
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/redis/go-redis/v9"
	"github.com/sirupsen/logrus"

	"github.com/tidecanvas/tide-canvas-go/internal/middleware"
	appjwt "github.com/tidecanvas/tide-canvas-go/pkg/jwt"
	"github.com/tidecanvas/tide-canvas-go/pkg/response"
)

// Handler 监控模块 HTTP 层，统一挂载于 /api/admin/monitor/*（对齐前端 adminApi.monitor）。
type Handler struct {
	svc *Service
}

// NewHandler 构造监控 Handler。rdb 可为 nil（未配置 Redis 时 redis 接口回退 connected=false）；logger 可为 nil。
func NewHandler(db *gorm.DB, rdb *redis.Client, logger *logrus.Logger) *Handler {
	return &Handler{svc: NewService(NewRepository(db), rdb, logger)}
}

// RegisterRoutes 注册监控路由（传入 /api 组 → 实际 /api/admin/monitor/*）。
//
// 校验链：JWTAuth（注入当前用户）→ AdminOnly（限管理员）→ RequiresPermission("monitor:view")。
// permLoader 由 router 注入一次后复用。
func (h *Handler) RegisterRoutes(api gin.IRouter, jwtProvider *appjwt.Provider, permLoader middleware.PermissionLoader) {
	g := api.Group("/admin/monitor")
	g.Use(middleware.JWTAuth(jwtProvider), middleware.AdminOnly())
	g.GET("/system", middleware.RequiresPermission(permLoader, "monitor:view"), h.system)
	g.GET("/redis", middleware.RequiresPermission(permLoader, "monitor:view"), h.redis)
	g.GET("/sessions", middleware.RequiresPermission(permLoader, "monitor:view"), h.sessions)
}

// system GET /api/admin/monitor/system 系统运行指标（CPU/内存/磁盘/网卡/认证统计/健康评分）。
func (h *Handler) system(c *gin.Context) {
	response.OK(c, h.svc.SystemMetrics())
}

// redis GET /api/admin/monitor/redis Redis 接入状态（未配置→connected=false）。
func (h *Handler) redis(c *gin.Context) {
	response.OK(c, h.svc.RedisInfo())
}

// sessions GET /api/admin/monitor/sessions 近期在线会话（access_log 近 15 分钟按 IP 去重近似）。
func (h *Handler) sessions(c *gin.Context) {
	response.OK(c, h.svc.Sessions())
}
