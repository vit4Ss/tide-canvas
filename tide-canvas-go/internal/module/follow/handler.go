package follow

import (
	"github.com/gin-gonic/gin"

	"github.com/tidecanvas/tide-canvas-go/internal/middleware"
	"github.com/tidecanvas/tide-canvas-go/pkg/ecode"
	appjwt "github.com/tidecanvas/tide-canvas-go/pkg/jwt"
	"github.com/tidecanvas/tide-canvas-go/pkg/response"
)

// Handler 关注 HTTP 层（前缀 /api/follow）。全部需登录。
type Handler struct {
	svc *Service
}

// NewHandler 构造。
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// RegisterRoutes 注册关注路由到给定父组（传入 /api 组 → 实际 /api/follow/*）。全部需登录。
//
// 路由顺序：静态段 /following、/followers 先于动态段 /:userId 注册，避免被 :userId 吞掉。
func (h *Handler) RegisterRoutes(api gin.IRouter, jwtProvider *appjwt.Provider) {
	g := api.Group("/follow")
	g.Use(middleware.JWTAuth(jwtProvider))

	g.GET("/following", h.following)
	g.GET("/followers", h.followers)
	g.POST("/:userId", h.follow)
	g.DELETE("/:userId", h.unfollow)
	g.GET("/:userId/status", h.status)
}

// follow 关注对方（userId 为对方 public_id）。
func (h *Handler) follow(c *gin.Context) {
	if err := h.svc.Follow(middleware.MustUserID(c), c.Param("userId")); err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, nil)
}

// unfollow 取关（userId 为对方 public_id）。
func (h *Handler) unfollow(c *gin.Context) {
	if err := h.svc.Unfollow(middleware.MustUserID(c), c.Param("userId")); err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, nil)
}

// status 关注状态 → {following, followedBy}。
func (h *Handler) status(c *gin.Context) {
	vo, err := h.svc.Status(middleware.MustUserID(c), c.Param("userId"))
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vo)
}

// following 我关注的人（分页）。
func (h *Handler) following(c *gin.Context) {
	var query FollowQuery
	if err := c.ShouldBindQuery(&query); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	data, err := h.svc.ListFollowing(middleware.MustUserID(c), &query)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, response.Page(data.Records, data.Total, data.PageNum, data.PageSize))
}

// followers 关注我的人（分页）。
func (h *Handler) followers(c *gin.Context) {
	var query FollowQuery
	if err := c.ShouldBindQuery(&query); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	data, err := h.svc.ListFollowers(middleware.MustUserID(c), &query)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, response.Page(data.Records, data.Total, data.PageNum, data.PageSize))
}
