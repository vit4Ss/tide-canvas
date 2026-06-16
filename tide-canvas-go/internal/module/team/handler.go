package team

import (
	"github.com/gin-gonic/gin"

	"github.com/tidecanvas/tide-canvas-go/internal/middleware"
	"github.com/tidecanvas/tide-canvas-go/pkg/ecode"
	appjwt "github.com/tidecanvas/tide-canvas-go/pkg/jwt"
	"github.com/tidecanvas/tide-canvas-go/pkg/response"
)

// Handler 团队 HTTP 层（对齐 TeamController，@RequestMapping("/api/teams")）。
type Handler struct {
	svc *Service
	jwt *appjwt.Provider
}

// NewHandler 构造。
func NewHandler(svc *Service, jwtProvider *appjwt.Provider) *Handler {
	return &Handler{svc: svc, jwt: jwtProvider}
}

// RegisterRoutes 注册团队路由到父组（传入 /api 组 → 实际 /api/teams/*）。全部需登录。
func (h *Handler) RegisterRoutes(api gin.IRouter, jwtProvider *appjwt.Provider) {
	g := api.Group("/teams")
	g.Use(middleware.JWTAuth(jwtProvider))

	g.GET("/me", h.myTeam)
	g.POST("", h.create)
	g.POST("/join", h.join)
	g.POST("/leave", h.leave)
	g.POST("/disband", h.disband)
	g.DELETE("/members/:userId", h.removeMember)
}

// myTeam 我的团队（不在团队返回 data=null）。
func (h *Handler) myTeam(c *gin.Context) {
	vo, err := h.svc.GetMyTeam(middleware.MustUserID(c))
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vo)
}

// create 创建团队。
func (h *Handler) create(c *gin.Context) {
	var req CreateReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	vo, err := h.svc.CreateTeam(middleware.MustUserID(c), &req)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vo)
}

// join 凭邀请码加入团队。
func (h *Handler) join(c *gin.Context) {
	var req JoinReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	vo, err := h.svc.JoinByCode(middleware.MustUserID(c), &req)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vo)
}

// leave 退出团队（管理员需先解散）。
func (h *Handler) leave(c *gin.Context) {
	if err := h.svc.LeaveTeam(middleware.MustUserID(c)); err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, nil)
}

// disband 解散团队（仅管理员）。
func (h *Handler) disband(c *gin.Context) {
	if err := h.svc.Disband(middleware.MustUserID(c)); err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, nil)
}

// removeMember 移除成员（仅管理员）。路径参数为成员的 public_id（遵循对外ID规范）。
func (h *Handler) removeMember(c *gin.Context) {
	targetUserID, err := h.svc.ResolveUserID(c.Param("userId"))
	if err != nil {
		response.FailErr(c, err)
		return
	}
	if err := h.svc.RemoveMember(middleware.MustUserID(c), targetUserID); err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, nil)
}
