package oauth

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	authmod "github.com/tidecanvas/tide-canvas-go/internal/module/auth"
	"github.com/tidecanvas/tide-canvas-go/pkg/ecode"
	appjwt "github.com/tidecanvas/tide-canvas-go/pkg/jwt"
	"github.com/tidecanvas/tide-canvas-go/pkg/response"
)

// Handler 第三方登录 HTTP 层。
type Handler struct {
	service *Service
	jwt     *appjwt.Provider
}

const (
	oauthStateCookie = "tc_oauth_state"
	oauthStateMaxAge = 10 * 60
)

// NewHandler 构造。
func NewHandler(svc *Service, jwtProvider ...*appjwt.Provider) *Handler {
	var p *appjwt.Provider
	if len(jwtProvider) > 0 {
		p = jwtProvider[0]
	}
	return &Handler{service: svc, jwt: p}
}

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
	vo, err := h.service.AuthorizeURL(provider, redirectURI)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	setOAuthStateCookie(c, provider, vo.State)
	response.OK(c, vo)
}

func (h *Handler) githubCallback(c *gin.Context) {
	req, ok := bindCallback(c, ProviderGitHub)
	if !ok {
		return
	}
	vo, err := h.service.GitHubLogin(req)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	if h.jwt != nil {
		authmod.SetLoginCookies(c, h.jwt, vo)
	}
	response.OK(c, vo)
}

func (h *Handler) googleCallback(c *gin.Context) {
	req, ok := bindCallback(c, ProviderGoogle)
	if !ok {
		return
	}
	vo, err := h.service.GoogleLogin(req)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	if h.jwt != nil {
		authmod.SetLoginCookies(c, h.jwt, vo)
	}
	response.OK(c, vo)
}

func (h *Handler) wechatCallback(c *gin.Context) {
	req, ok := bindCallback(c, ProviderWeChat)
	if !ok {
		return
	}
	vo, err := h.service.WeChatLogin(req)
	if err != nil {
		response.FailErr(c, err)
		return
	}
	if h.jwt != nil {
		authmod.SetLoginCookies(c, h.jwt, vo)
	}
	response.OK(c, vo)
}

// bindCallback 绑定回调请求体；失败时已写出错误响应并返回 ok=false。
func bindCallback(c *gin.Context, provider Provider) (*CallbackReq, bool) {
	var req CallbackReq
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, ecode.BadRequest.WithMessage("code/state不能为空"))
		return nil, false
	}
	if !validateOAuthState(c, provider, req.State) {
		clearOAuthStateCookie(c)
		response.Fail(c, ecode.BadRequest.WithMessage("OAuth state无效或已过期"))
		return nil, false
	}
	clearOAuthStateCookie(c)
	return &req, true
}

func setOAuthStateCookie(c *gin.Context, provider Provider, state string) {
	secure := c.Request.TLS != nil || c.GetHeader("X-Forwarded-Proto") == "https"
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(oauthStateCookie, string(provider)+"|"+state, oauthStateMaxAge, "/api/auth/oauth", "", secure, true)
}

func clearOAuthStateCookie(c *gin.Context) {
	secure := c.Request.TLS != nil || c.GetHeader("X-Forwarded-Proto") == "https"
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(oauthStateCookie, "", -1, "/api/auth/oauth", "", secure, true)
}

func validateOAuthState(c *gin.Context, provider Provider, state string) bool {
	state = strings.TrimSpace(state)
	if state == "" {
		return false
	}
	cookie, err := c.Cookie(oauthStateCookie)
	if err != nil {
		return false
	}
	want := string(provider) + "|" + state
	return cookie == want
}
