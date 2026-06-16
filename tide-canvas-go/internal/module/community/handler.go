package community

import (
	"time"

	"github.com/gin-gonic/gin"

	"github.com/tidecanvas/tide-canvas-go/internal/middleware"
	"github.com/tidecanvas/tide-canvas-go/pkg/ecode"
	appjwt "github.com/tidecanvas/tide-canvas-go/pkg/jwt"
	"github.com/tidecanvas/tide-canvas-go/pkg/response"
)

// Handler 社区 HTTP 层（对齐 CommunityController，旧前缀 /api/posts；本项目挂载于 /community/posts）。
type Handler struct {
	svc *Service
}

// NewHandler 构造。
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// RegisterRoutes 注册社区路由到给定父组（传入 /community 组 → 实际为 /community/posts/*）。
//
// 鉴权（对齐旧 SecurityUtils.getCurrentUserId 强制 / getCurrentUserIdOrNull 可选）：
//   - 写操作（发帖/改帖/删帖/点赞/评论/删评）强制登录 JWTAuth；
//   - 读操作（列表/详情/评论列表）可选登录 OptionalAuth，登录时回填 liked 标记。
func (h *Handler) RegisterRoutes(api gin.IRouter, jwtProvider *appjwt.Provider) {
	g := api.Group("/posts")

	// 读操作：可选登录
	pub := g.Group("")
	pub.Use(middleware.OptionalAuth(jwtProvider))
	pub.GET("", h.list)
	pub.GET("/:id", h.get)
	pub.GET("/:id/comments", h.listComments)

	// 写操作：强制登录
	authed := g.Group("")
	authed.Use(middleware.JWTAuth(jwtProvider))
	authed.POST("", middleware.RateLimit(middleware.RateLimitOptions{
		Name: "community_post", Limit: 10, Period: 60 * time.Second, Dimension: middleware.DimUser, BanThreshold: 0,
	}), h.create)
	authed.PUT("/:id", h.update)
	authed.DELETE("/:id", h.delete)
	authed.POST("/:id/like", h.toggleLike)
	authed.POST("/:id/comments", middleware.RateLimit(middleware.RateLimitOptions{
		Name: "community_comment", Limit: 20, Period: 60 * time.Second, Dimension: middleware.DimUser, BanThreshold: 0,
	}), h.createComment)
	authed.DELETE("/comments/:commentId", h.deleteComment)
}

// create 发布帖子。
func (h *Handler) create(c *gin.Context) {
	var req PostCreateReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	vo, err := h.svc.CreatePost(middleware.MustUserID(c), &req)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vo)
}

// update 更新帖子。
func (h *Handler) update(c *gin.Context) {
	var req PostUpdateReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	if err := h.svc.UpdatePost(middleware.MustUserID(c), c.Param("id"), &req); err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, nil)
}

// delete 删除帖子。
func (h *Handler) delete(c *gin.Context) {
	if err := h.svc.DeletePost(middleware.MustUserID(c), c.Param("id")); err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, nil)
}

// get 帖子详情（浏览量+1）。匿名访问 liked 恒 false。
func (h *Handler) get(c *gin.Context) {
	vo, err := h.svc.GetPost(c.Param("id"), middleware.MustUserID(c))
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vo)
}

// list 帖子列表（分页，按分类/作者过滤）。
func (h *Handler) list(c *gin.Context) {
	var query PostQuery
	if err := c.ShouldBindQuery(&query); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	data, err := h.svc.ListPosts(&query, middleware.MustUserID(c))
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, response.Page(data.Records, data.Total, data.PageNum, data.PageSize))
}

// toggleLike 点赞 / 取消点赞（返回 true=已点赞）。
func (h *Handler) toggleLike(c *gin.Context) {
	liked, err := h.svc.ToggleLikePost(middleware.MustUserID(c), c.Param("id"))
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, liked)
}

// createComment 发表评论（楼中楼：parentId 为父评论 public_id）。
func (h *Handler) createComment(c *gin.Context) {
	var req CommentCreateReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	vo, err := h.svc.AddComment(middleware.MustUserID(c), c.Param("id"), &req)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vo)
}

// listComments 评论列表（树形）。
func (h *Handler) listComments(c *gin.Context) {
	vos, err := h.svc.ListComments(c.Param("id"))
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vos)
}

// deleteComment 删除评论。
func (h *Handler) deleteComment(c *gin.Context) {
	if err := h.svc.DeleteComment(middleware.MustUserID(c), c.Param("commentId")); err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, nil)
}
