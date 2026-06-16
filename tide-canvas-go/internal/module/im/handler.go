package im

import (
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/tidecanvas/tide-canvas-go/internal/middleware"
	"github.com/tidecanvas/tide-canvas-go/pkg/ecode"
	appjwt "github.com/tidecanvas/tide-canvas-go/pkg/jwt"
	"github.com/tidecanvas/tide-canvas-go/pkg/response"
)

// Handler IM HTTP 层（REST + WebSocket 入口）。
type Handler struct {
	svc *Service
	ws  *WSHandler
}

// NewHandler 构造。
func NewHandler(svc *Service, ws *WSHandler) *Handler {
	return &Handler{svc: svc, ws: ws}
}

// RegisterRoutes 注册 /api/im/* 路由。
//   - WebSocket /api/im/ws：握手自鉴权（query token），不经 JWTAuth 中间件。
//   - REST：JWTAuth；客服端/后台会话再加 AdminOnly（简单接入：管理员即客服/后台使用者）。
func (h *Handler) RegisterRoutes(api gin.IRouter, jwtProvider *appjwt.Provider) {
	g := api.Group("/im")

	// WebSocket 长连接（在线状态来源 + 实时推送）。
	g.GET("/ws", h.ws.Serve)

	authed := g.Group("")
	authed.Use(middleware.JWTAuth(jwtProvider))
	authed.GET("/conversations", h.listConversations)
	authed.POST("/conversations/private", h.openPrivate)
	authed.POST("/conversations/support", h.openSupport)
	authed.GET("/conversations/:id/messages", h.listMessages)
	authed.POST("/messages", middleware.RateLimit(middleware.RateLimitOptions{
		Name: "im_send", Limit: 60, Period: 60 * time.Second, Dimension: middleware.DimUser, BanThreshold: 0,
	}), h.sendMessage)
	authed.POST("/messages/read", h.markRead)
	authed.POST("/messages/:id/recall", h.recall)
	authed.GET("/status", h.userStatus)

	// 客服端 + 后台会话（管理员）
	staff := authed.Group("")
	staff.Use(middleware.AdminOnly())
	staff.POST("/conversations/staff", h.openStaff)
	staff.GET("/support/waiting", h.supportWaiting)
	staff.POST("/support/:id/accept", h.supportAccept)
}

func (h *Handler) listConversations(c *gin.Context) {
	var q PageQuery
	_ = c.ShouldBindQuery(&q)
	vos, total, err := h.svc.ListConversations(middleware.MustUserID(c), c.Query("type"), &q)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, response.Page(vos, total, q.PageNum, q.PageSize))
}

func (h *Handler) openPrivate(c *gin.Context) {
	var req OpenPrivateReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	vo, err := h.svc.OpenPrivate(middleware.MustUserID(c), &req)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vo)
}

func (h *Handler) openSupport(c *gin.Context) {
	vo, err := h.svc.OpenSupport(middleware.MustUserID(c))
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vo)
}

func (h *Handler) openStaff(c *gin.Context) {
	var req OpenStaffReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	vo, err := h.svc.OpenStaff(middleware.MustUserID(c), &req)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vo)
}

func (h *Handler) listMessages(c *gin.Context) {
	limit := atoiDefault(c.Query("limit"), 30)
	vos, err := h.svc.ListMessages(middleware.MustUserID(c), c.Param("id"), c.Query("before"), limit)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vos)
}

func (h *Handler) sendMessage(c *gin.Context) {
	var req SendMessageReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	vo, err := h.svc.SendMessage(middleware.MustUserID(c), &req)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vo)
}

func (h *Handler) markRead(c *gin.Context) {
	var req MarkReadReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	if err := h.svc.MarkRead(middleware.MustUserID(c), &req); err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, nil)
}

func (h *Handler) recall(c *gin.Context) {
	if err := h.svc.Recall(middleware.MustUserID(c), c.Param("id")); err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, nil)
}

func (h *Handler) userStatus(c *gin.Context) {
	idsParam := c.Query("ids")
	if idsParam == "" {
		response.OK(c, []UserStatusVO{})
		return
	}
	vos, err := h.svc.GetUserStatus(strings.Split(idsParam, ","))
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vos)
}

func (h *Handler) supportWaiting(c *gin.Context) {
	var q PageQuery
	_ = c.ShouldBindQuery(&q)
	vos, total, err := h.svc.ListWaitingSupport(&q)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, response.Page(vos, total, q.PageNum, q.PageSize))
}

func (h *Handler) supportAccept(c *gin.Context) {
	vo, err := h.svc.AcceptSupport(middleware.MustUserID(c), c.Param("id"))
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vo)
}

func atoiDefault(s string, def int) int {
	if s == "" {
		return def
	}
	if n, err := strconv.Atoi(s); err == nil {
		return n
	}
	return def
}
