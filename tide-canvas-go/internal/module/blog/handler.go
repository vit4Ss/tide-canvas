package blog

import (
	"github.com/gin-gonic/gin"

	"github.com/tidecanvas/tide-canvas-go/internal/middleware"
	"github.com/tidecanvas/tide-canvas-go/pkg/ecode"
	appjwt "github.com/tidecanvas/tide-canvas-go/pkg/jwt"
	"github.com/tidecanvas/tide-canvas-go/pkg/response"
)

// Handler 博客 HTTP 层（对齐 BlogController，前缀 /api/blogs）。
type Handler struct {
	svc *Service
}

// NewHandler 构造。
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// RegisterRoutes 注册博客路由到给定父组（传入 /api 组 → 实际为 /api/blogs/*）。
//
// 鉴权分组（对齐 BlogController）：
//   - 列表 / 详情：可选登录（OptionalAuth）—— 未登录可浏览，登录则带 liked / purchased 状态。
//   - 我的博客 / 发布 / 更新 / 删除 / 购买 / 打赏 / 点赞：强制登录（JWTAuth）。
//
// 旧 Controller 对发布/更新/删除标注 hasRole('AUTHOR')；这里发布的签约作者校验在 service 内
// （user.IsAuthor，否则 ecode.NotAuthor），更新/删除以 service 的所有权校验为准。
func (h *Handler) RegisterRoutes(api gin.IRouter, jwtProvider *appjwt.Provider) {
	// 可选登录组：列表与详情。
	pub := api.Group("/blogs")
	pub.Use(middleware.OptionalAuth(jwtProvider))
	pub.GET("", h.list)
	pub.GET("/:id", h.get)

	// 强制登录组。注意：静态路径 /blogs/my 优先于 /blogs/:id，路由匹配无歧义。
	authed := api.Group("/blogs")
	authed.Use(middleware.JWTAuth(jwtProvider))
	authed.GET("/my", h.myBlogs)
	authed.POST("", h.create)
	authed.PUT("/:id", h.update)
	authed.DELETE("/:id", h.delete)
	authed.POST("/:id/purchase", h.purchase)
	authed.POST("/:id/tip", h.tip)
	authed.POST("/:id/like", h.toggleLike)
}

func (h *Handler) create(c *gin.Context) {
	var req BlogCreateReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	vo, err := h.svc.CreateBlog(middleware.MustUserID(c), &req)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vo)
}

func (h *Handler) update(c *gin.Context) {
	var req BlogUpdateReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	if err := h.svc.UpdateBlog(middleware.MustUserID(c), c.Param("id"), &req); err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, nil)
}

func (h *Handler) delete(c *gin.Context) {
	if err := h.svc.DeleteBlog(middleware.MustUserID(c), c.Param("id")); err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, nil)
}

func (h *Handler) get(c *gin.Context) {
	vo, err := h.svc.GetBlog(c.Param("id"), optionalUserID(c))
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vo)
}

func (h *Handler) list(c *gin.Context) {
	var query BlogQuery
	if err := c.ShouldBindQuery(&query); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	data, err := h.svc.ListBlogs(&query, optionalUserID(c))
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, response.Page(data.Records, data.Total, data.PageNum, data.PageSize))
}

func (h *Handler) purchase(c *gin.Context) {
	if err := h.svc.PurchaseBlog(middleware.MustUserID(c), c.Param("id")); err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, nil)
}

func (h *Handler) tip(c *gin.Context) {
	var req BlogTipReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	if err := h.svc.TipBlog(middleware.MustUserID(c), c.Param("id"), &req); err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, nil)
}

func (h *Handler) toggleLike(c *gin.Context) {
	liked, err := h.svc.ToggleLikeBlog(middleware.MustUserID(c), c.Param("id"))
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, liked)
}

func (h *Handler) myBlogs(c *gin.Context) {
	var query BlogQuery
	if err := c.ShouldBindQuery(&query); err != nil {
		response.Fail(c, ecode.BadRequest)
		return
	}
	data, err := h.svc.ListMyBlogs(middleware.MustUserID(c), &query)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, response.Page(data.Records, data.Total, data.PageNum, data.PageSize))
}

// optionalUserID 从可选鉴权上下文取当前用户ID，未登录返回 nil（对齐 tryGetCurrentUserId）。
func optionalUserID(c *gin.Context) *int64 {
	if id, ok := middleware.CurrentUserID(c); ok {
		return &id
	}
	return nil
}
