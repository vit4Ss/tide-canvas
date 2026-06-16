package oauth

import (
	"github.com/gin-gonic/gin"

	"github.com/tidecanvas/tide-canvas-go/pkg/ecode"
	"github.com/tidecanvas/tide-canvas-go/pkg/response"
)

// Handler 第三方登录 HTTP 层。
type Handler struct {
	svc *Service
}

// NewHandler 构造。
func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// RegisterRoutes 注册第三方登录路由到 /api 组 → 实际路径 /api/auth/oauth/*。
// 授权与回调均为公开接口，无需 JWTAuth（对齐旧 OAuthController @RequestMapping("/api/auth/oauth")）。
func (h *Handler) RegisterRoutes(api gin.IRouter) {
	g := api.Group("/auth/oauth")
	// 授权跳转地址（前端重定向到第三方授权页）。
	g.GET("/:provider/authorize", h.authorize)
	// 回调换登录态（对齐旧 POST /github /google /wechat）。
	g.POST("/github", h.githubCallback)
	g.POST("/google", h.googleCallback)
	g.POST("/wechat", h.wechatCallback)
}

// authorize 生成第三方授权页地址。query: redirectUri（回调地址）。
func (h *Handler) authorize(c *gin.Context) {
	provider := Provider(c.Param("provider"))
	redirectURI := c.Query("redirectUri")
	vo, err := h.svc.AuthorizeURL(provider, redirectURI)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vo)
}

func (h *Handler) githubCallback(c *gin.Context) {
	req, ok := bindCallback(c)
	if !ok {
		return
	}
	vo, err := h.svc.GitHubLogin(req)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vo)
}

func (h *Handler) googleCallback(c *gin.Context) {
	req, ok := bindCallback(c)
	if !ok {
		return
	}
	vo, err := h.svc.GoogleLogin(req)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vo)
}

func (h *Handler) wechatCallback(c *gin.Context) {
	req, ok := bindCallback(c)
	if !ok {
		return
	}
	vo, err := h.svc.WeChatLogin(req)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	response.OK(c, vo)
}

// bindCallback 绑定回调请求体；失败时已写出错误响应并返回 ok=false。
func bindCallback(c *gin.Context) (*CallbackReq, bool) {
	var req CallbackReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, ecode.BadRequest.WithMessage("code不能为空"))
		return nil, false
	}
	return &req, true
}
