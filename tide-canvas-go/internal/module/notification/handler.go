package notification

import (
	"github.com/gin-gonic/gin"

	"github.com/tidecanvas/tide-canvas-go/internal/middleware"
	"github.com/tidecanvas/tide-canvas-go/pkg/ecode"
	appjwt "github.com/tidecanvas/tide-canvas-go/pkg/jwt"
	"github.com/tidecanvas/tide-canvas-go/pkg/response"
)

// Handler 通知 HTTP 层（前缀 /api/notifications）。全部需登录。
type Handler struct {
	svc *Service
}

// NewHandler 构造。
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// RegisterRoutes 注册通知路由到给定父组（传入 /api 组 → 实际 /api/notifications/*）。全部需登录。
func (h *Handler) RegisterRoutes(api gin.IRouter, jwtProvider *appjwt.Provider) {
	g := api.Group("/notifications")
	g.Use(middleware.JWTAuth(jwtProvider))

	g.GET("", h.list)
	g.GET("/unread-count", h.unreadCount)
	g.POST("/read", h.read)
	g.POST("/read-all", h.readAll)
}

// list 通知列表（分页，?type=&pageNum=&pageSize=）。
func (h *Handler) list(c *gin.Context) {
	var query NotificationQuery
	if err := c.ShouldBindQuery(&query); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	data, err := h.svc.List(middleware.MustUserID(c), &query)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, response.Page(data.Records, data.Total, data.PageNum, data.PageSize))
}

// unreadCount 未读通知数 → {count}。
func (h *Handler) unreadCount(c *gin.Context) {
	n, err := h.svc.CountUnread(middleware.MustUserID(c))
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, gin.H{"count": n})
}

// read 标记指定通知为已读（{ids:[number]}）。
func (h *Handler) read(c *gin.Context) {
	var req ReadReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	if err := h.svc.MarkRead(middleware.MustUserID(c), req.IDs); err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, nil)
}

// readAll 标记全部通知为已读。
func (h *Handler) readAll(c *gin.Context) {
	if err := h.svc.MarkAllRead(middleware.MustUserID(c)); err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, nil)
}
