// Package oauth 第三方登录模块：GitHub / Google / 微信。
// 对齐旧后端 OAuthController：回调 code → 换 access_token → 拉用户信息 →
// 按 oauth 用户名/邮箱查或建 sys_user → 签发 JWT 返回 LoginVO（复用 auth 包的 VO）。
package oauth

import "github.com/tidecanvas/tide-canvas-go/internal/module/auth"

// Provider 第三方登录提供方标识。
type Provider string

// 支持的第三方提供方。
const (
	ProviderGitHub Provider = "github"
	ProviderGoogle Provider = "google"
	ProviderWeChat Provider = "wechat"
)

// CallbackReq 第三方登录回调请求体（对齐旧 @RequestBody Map<String,String>）。
// code 必填；redirectUri 仅 Google 换 token 时需要（须与授权阶段一致）。
type CallbackReq struct {
	Code        string `json:"code" binding:"required"`
	State       string `json:"state" binding:"required"`
	RedirectURI string `json:"redirectUri"`
}

// AuthorizeVO 授权跳转地址（前端拿到后重定向到第三方授权页）。
type AuthorizeVO struct {
	// AuthorizeURL 第三方授权页完整地址（含 client_id/redirect_uri/scope/state）。
	AuthorizeURL string `json:"authorizeUrl"`
	// State 防 CSRF 随机串，前端在回调时应原样校验。
	State string `json:"state"`
}

// LoginVO 登录响应，直接复用 auth 包定义，保证与账号密码登录响应结构一致。
type LoginVO = auth.LoginVO

// UserVO 用户信息视图，复用 auth 包定义。
type UserVO = auth.UserVO
