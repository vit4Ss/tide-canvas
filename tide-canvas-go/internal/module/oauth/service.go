package oauth

import (
	"net/url"
	"strings"
	"time"

	"github.com/go-resty/resty/v2"
	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"github.com/sirupsen/logrus"
	"github.com/spf13/viper"

	"github.com/tidecanvas/tide-canvas-go/internal/model"
	"github.com/tidecanvas/tide-canvas-go/internal/module/user"
	"github.com/tidecanvas/tide-canvas-go/pkg/ecode"
	appjwt "github.com/tidecanvas/tide-canvas-go/pkg/jwt"
	"github.com/tidecanvas/tide-canvas-go/pkg/password"
)

// 新建第三方用户默认值，对齐 auth 注册 / 旧 OAuthController.findOrCreateOAuthUser。
const (
	defaultAPIQuota     = 100
	defaultPoints       = 100
	defaultStorageQuota = int64(1073741824) // 1G
	httpTimeout         = 15 * time.Second
)

// 第三方接口地址（对齐旧 OAuthController 硬编码端点）。
const (
	githubTokenURL = "https://github.com/login/oauth/access_token"
	githubUserURL  = "https://api.github.com/user"
	githubAuthURL  = "https://github.com/login/oauth/authorize"

	googleTokenURL = "https://oauth2.googleapis.com/token"
	googleUserURL  = "https://www.googleapis.com/oauth2/v2/userinfo"
	googleAuthURL  = "https://accounts.google.com/o/oauth2/v2/auth"

	wechatTokenURL = "https://api.weixin.qq.com/sns/oauth2/access_token"
	wechatUserURL  = "https://api.weixin.qq.com/sns/userinfo"
	wechatAuthURL  = "https://open.weixin.qq.com/connect/qrconnect"
)

// providerConfig 单个提供方凭据（client_id/secret，统一字段名；微信对应 app_id/app_secret）。
type providerConfig struct {
	clientID     string
	clientSecret string
}

// Service 第三方登录业务逻辑（对齐 OAuthController）。
type Service struct {
	users  *user.Repository
	jwt    *appjwt.Provider
	conf   *viper.Viper
	logger *logrus.Logger
	http   *resty.Client
}

// NewService 构造第三方登录服务。配置从 viper 读取（懒读，便于运行期热更）。
func NewService(userRepo *user.Repository, jwt *appjwt.Provider, conf *viper.Viper, logger *logrus.Logger) *Service {
	return &Service{
		users:  userRepo,
		jwt:    jwt,
		conf:   conf,
		logger: logger,
		http:   resty.New().SetTimeout(httpTimeout),
	}
}

// ---- 配置读取（viper 下划线键风格：oauth.github.client_id 等）----

func (s *Service) githubConfig() providerConfig {
	return providerConfig{
		clientID:     strings.TrimSpace(s.conf.GetString("oauth.github.client_id")),
		clientSecret: strings.TrimSpace(s.conf.GetString("oauth.github.client_secret")),
	}
}

func (s *Service) googleConfig() providerConfig {
	return providerConfig{
		clientID:     strings.TrimSpace(s.conf.GetString("oauth.google.client_id")),
		clientSecret: strings.TrimSpace(s.conf.GetString("oauth.google.client_secret")),
	}
}

func (s *Service) wechatConfig() providerConfig {
	return providerConfig{
		clientID:     strings.TrimSpace(s.conf.GetString("oauth.wechat.app_id")),
		clientSecret: strings.TrimSpace(s.conf.GetString("oauth.wechat.app_secret")),
	}
}

func requireConfig(cfg providerConfig, providerName string) error {
	if cfg.clientID == "" || cfg.clientSecret == "" {
		return ecode.ServerError.WithMessage(providerName + " OAuth未配置，请联系管理员")
	}
	return nil
}

// ==================== 授权跳转 URL ====================

// AuthorizeURL 构造第三方授权页地址（前端重定向用）。redirectURI 为回调地址，state 防 CSRF。
// 旧后端无此接口（前端直接拼），此处补全以统一由后端持有 client_id 与 scope。
func (s *Service) AuthorizeURL(provider Provider, redirectURI string) (*AuthorizeVO, error) {
	state := strings.ReplaceAll(uuid.NewString(), "-", "")
	switch provider {
	case ProviderGitHub:
		cfg := s.githubConfig()
		if err := requireConfig(cfg, "GitHub"); err != nil {
			return nil, err
		}
		q := url.Values{}
		q.Set("client_id", cfg.clientID)
		q.Set("redirect_uri", redirectURI)
		q.Set("scope", "read:user user:email")
		q.Set("state", state)
		return &AuthorizeVO{AuthorizeURL: githubAuthURL + "?" + q.Encode(), State: state}, nil
	case ProviderGoogle:
		cfg := s.googleConfig()
		if err := requireConfig(cfg, "Google"); err != nil {
			return nil, err
		}
		q := url.Values{}
		q.Set("client_id", cfg.clientID)
		q.Set("redirect_uri", redirectURI)
		q.Set("response_type", "code")
		q.Set("scope", "openid email profile")
		q.Set("state", state)
		return &AuthorizeVO{AuthorizeURL: googleAuthURL + "?" + q.Encode(), State: state}, nil
	case ProviderWeChat:
		cfg := s.wechatConfig()
		if err := requireConfig(cfg, "微信"); err != nil {
			return nil, err
		}
		q := url.Values{}
		q.Set("appid", cfg.clientID)
		q.Set("redirect_uri", redirectURI)
		q.Set("response_type", "code")
		q.Set("scope", "snsapi_login")
		q.Set("state", state)
		// 微信要求 state 之后再带锚点 #wechat_redirect
		return &AuthorizeVO{AuthorizeURL: wechatAuthURL + "?" + q.Encode() + "#wechat_redirect", State: state}, nil
	default:
		return nil, ecode.BadRequest.WithMessage("不支持的第三方登录类型")
	}
}

// ==================== GitHub ====================

// githubResp GitHub 用户信息部分字段。
type githubUserResp struct {
	Login     string `json:"login"`
	Email     string `json:"email"`
	Name      string `json:"name"`
	AvatarURL string `json:"avatar_url"`
}

// GitHubLogin GitHub 回调：code → access_token → 用户信息 → 查/建用户 → 签发令牌。
func (s *Service) GitHubLogin(req *CallbackReq) (*LoginVO, error) {
	cfg := s.githubConfig()
	if err := requireConfig(cfg, "GitHub"); err != nil {
		return nil, err
	}

	accessToken, err := s.exchangeJSONToken(githubTokenURL, map[string]string{
		"client_id":     cfg.clientID,
		"client_secret": cfg.clientSecret,
		"code":          req.Code,
	}, "GitHub")
	if err != nil {
		return nil, err
	}

	var u githubUserResp
	if err := s.fetchUserInfo(githubUserURL, accessToken, &u, "GitHub"); err != nil {
		return nil, err
	}
	if u.Login == "" {
		return nil, ecode.ServerError.WithMessage("获取GitHub用户信息失败")
	}

	email := u.Email
	if email == "" {
		email = u.Login + "@github.tidecanvas.com"
	}
	nickname := u.Name
	if nickname == "" {
		nickname = u.Login
	}
	usr, err := s.findOrCreateOAuthUser("gh_"+u.Login, email, nickname, u.AvatarURL)
	if err != nil {
		return nil, err
	}
	return s.buildLoginVO(usr)
}

// ==================== Google ====================

// googleUserResp Google 用户信息部分字段。
type googleUserResp struct {
	ID      string `json:"id"`
	Email   string `json:"email"`
	Name    string `json:"name"`
	Picture string `json:"picture"`
}

// GoogleLogin Google 回调：code(form) → access_token → 用户信息 → 查/建用户 → 签发令牌。
func (s *Service) GoogleLogin(req *CallbackReq) (*LoginVO, error) {
	cfg := s.googleConfig()
	if err := requireConfig(cfg, "Google"); err != nil {
		return nil, err
	}

	accessToken, err := s.exchangeFormToken(googleTokenURL, map[string]string{
		"code":          req.Code,
		"client_id":     cfg.clientID,
		"client_secret": cfg.clientSecret,
		"redirect_uri":  req.RedirectURI,
		"grant_type":    "authorization_code",
	}, "Google")
	if err != nil {
		return nil, err
	}

	var u googleUserResp
	if err := s.fetchUserInfo(googleUserURL, accessToken, &u, "Google"); err != nil {
		return nil, err
	}
	if u.ID == "" {
		return nil, ecode.ServerError.WithMessage("获取Google用户信息失败")
	}

	email := u.Email
	if email == "" {
		email = u.ID + "@google.tidecanvas.com"
	}
	nickname := u.Name
	if nickname == "" {
		nickname = u.ID
	}
	usr, err := s.findOrCreateOAuthUser("gg_"+u.ID, email, nickname, u.Picture)
	if err != nil {
		return nil, err
	}
	return s.buildLoginVO(usr)
}

// ==================== WeChat ====================

// wechatTokenResp 微信换 token 响应（含错误码与 openid/unionid）。
type wechatTokenResp struct {
	AccessToken string `json:"access_token"`
	OpenID      string `json:"openid"`
	UnionID     string `json:"unionid"`
	ErrCode     int    `json:"errcode"`
	ErrMsg      string `json:"errmsg"`
}

// wechatUserResp 微信用户信息响应。
type wechatUserResp struct {
	Nickname   string `json:"nickname"`
	HeadImgURL string `json:"headimgurl"`
	UnionID    string `json:"unionid"`
	ErrCode    int    `json:"errcode"`
	ErrMsg     string `json:"errmsg"`
}

// WeChatLogin 微信回调：code → access_token+openid → 用户信息 → 查/建用户 → 签发令牌。
func (s *Service) WeChatLogin(req *CallbackReq) (*LoginVO, error) {
	cfg := s.wechatConfig()
	if err := requireConfig(cfg, "微信"); err != nil {
		return nil, err
	}

	var tok wechatTokenResp
	if err := s.getJSON(wechatTokenURL, map[string]string{
		"appid":      cfg.clientID,
		"secret":     cfg.clientSecret,
		"code":       req.Code,
		"grant_type": "authorization_code",
	}, &tok, "微信"); err != nil {
		return nil, err
	}
	if tok.ErrCode != 0 {
		return nil, ecode.ServerError.WithMessage("微信授权失败: " + tok.ErrMsg)
	}
	if tok.OpenID == "" {
		return nil, ecode.ServerError.WithMessage("微信授权失败")
	}

	var u wechatUserResp
	if err := s.getJSON(wechatUserURL, map[string]string{
		"access_token": tok.AccessToken,
		"openid":       tok.OpenID,
		"lang":         "zh_CN",
	}, &u, "微信"); err != nil {
		return nil, err
	}
	if u.ErrCode != 0 {
		return nil, ecode.ServerError.WithMessage("获取微信用户信息失败: " + u.ErrMsg)
	}

	// 优先 unionid（用户信息接口的优先），其次 token 返回的 unionid，最后 openid。
	uniqueID := u.UnionID
	if uniqueID == "" {
		uniqueID = tok.UnionID
	}
	if uniqueID == "" {
		uniqueID = tok.OpenID
	}
	nickname := u.Nickname
	if nickname == "" {
		nickname = "微信用户"
	}
	usr, err := s.findOrCreateOAuthUser(
		"wx_"+uniqueID,
		uniqueID+"@wechat.tidecanvas.com",
		nickname,
		u.HeadImgURL,
	)
	if err != nil {
		return nil, err
	}
	return s.buildLoginVO(usr)
}

// ==================== 公共：HTTP ====================

// exchangeJSONToken 以 JSON body POST 换取 access_token（GitHub）。
func (s *Service) exchangeJSONToken(tokenURL string, body map[string]string, providerName string) (string, error) {
	var out struct {
		AccessToken string `json:"access_token"`
	}
	resp, err := s.http.R().
		SetHeader("Accept", "application/json").
		SetHeader("Content-Type", "application/json").
		SetBody(body).
		SetResult(&out).
		ForceContentType("application/json"). // 部分提供方响应 Content-Type 非 json，强制按 json 解析
		Post(tokenURL)
	if err != nil {
		s.errorf("%s token exchange failed: %v", providerName, err)
		return "", ecode.ServerError.WithMessage(providerName + "授权失败")
	}
	if resp.IsError() || out.AccessToken == "" {
		s.errorf("%s token exchange response: %s", providerName, resp.String())
		return "", ecode.ServerError.WithMessage(providerName + "授权失败")
	}
	return out.AccessToken, nil
}

// exchangeFormToken 以表单 POST 换取 access_token（Google）。
func (s *Service) exchangeFormToken(tokenURL string, form map[string]string, providerName string) (string, error) {
	var out struct {
		AccessToken string `json:"access_token"`
	}
	resp, err := s.http.R().
		SetHeader("Accept", "application/json").
		SetFormData(form).
		SetResult(&out).
		ForceContentType("application/json").
		Post(tokenURL)
	if err != nil {
		s.errorf("%s token exchange failed: %v", providerName, err)
		return "", ecode.ServerError.WithMessage(providerName + "授权失败")
	}
	if resp.IsError() || out.AccessToken == "" {
		s.errorf("%s token exchange response: %s", providerName, resp.String())
		return "", ecode.ServerError.WithMessage(providerName + "授权失败")
	}
	return out.AccessToken, nil
}

// fetchUserInfo 以 Bearer token GET 拉取用户信息并反序列化到 out。
func (s *Service) fetchUserInfo(userURL, accessToken string, out interface{}, providerName string) error {
	resp, err := s.http.R().
		SetHeader("Accept", "application/json").
		SetAuthToken(accessToken).
		SetResult(out).
		ForceContentType("application/json").
		Get(userURL)
	if err != nil {
		s.errorf("%s user info fetch failed: %v", providerName, err)
		return ecode.ServerError.WithMessage("获取" + providerName + "用户信息失败")
	}
	if resp.IsError() {
		s.errorf("%s user info response: %s", providerName, resp.String())
		return ecode.ServerError.WithMessage("获取" + providerName + "用户信息失败")
	}
	return nil
}

// getJSON 以查询参数 GET 一个 JSON 接口并反序列化到 out（微信 token/userinfo）。
func (s *Service) getJSON(endpoint string, params map[string]string, out interface{}, providerName string) error {
	resp, err := s.http.R().
		SetQueryParams(params).
		SetResult(out).
		ForceContentType("application/json"). // 微信接口 Content-Type 为 text/plain，强制按 json 解析
		Get(endpoint)
	if err != nil {
		s.errorf("%s API call failed: %s %v", providerName, endpoint, err)
		return ecode.ServerError.WithMessage(providerName + "接口调用失败")
	}
	if resp.IsError() {
		s.errorf("%s API response: %s", providerName, resp.String())
		return ecode.ServerError.WithMessage(providerName + "接口调用失败")
	}
	return nil
}

// ==================== 公共：用户与令牌 ====================

// findOrCreateOAuthUser 按 oauth 用户名查，未命中再按邮箱查；都没有则创建，命中则更新头像与登录时间。
// 对齐旧 OAuthController.findOrCreateOAuthUser。
func (s *Service) findOrCreateOAuthUser(oauthUsername, email, nickname, avatar string) (*model.SysUser, error) {
	u, err := s.users.FindByAccount(oauthUsername)
	if err != nil {
		return nil, err
	}
	if u == nil {
		if u, err = s.users.FindByAccount(email); err != nil {
			return nil, err
		}
	}

	if u == nil {
		// 随机密码（第三方用户不走密码登录），bcrypt 存储。
		hashed, err := password.Hash(uuid.NewString())
		if err != nil {
			return nil, err
		}
		u = &model.SysUser{
			Username:     oauthUsername,
			Email:        email,
			Password:     hashed,
			Nickname:     nickname,
			Avatar:       avatar,
			Role:         0,
			Status:       1,
			APIQuota:     defaultAPIQuota,
			Points:       defaultPoints,
			IsAuthor:     0,
			StorageQuota: defaultStorageQuota,
		}
		if err := s.users.Create(u); err != nil {
			return nil, err
		}
		return u, nil
	}

	// 已存在：刷新头像（若有）与最后登录时间。
	now := time.Now()
	cols := map[string]interface{}{"last_login_time": now}
	if avatar != "" {
		cols["avatar"] = avatar
		u.Avatar = avatar
	}
	if err := s.users.UpdateColumns(u.ID, cols); err != nil {
		return nil, err
	}
	u.LastLoginTime = &now
	return u, nil
}

// buildLoginVO 签发双令牌并组装登录响应（对齐 auth.buildLoginVO）。
func (s *Service) buildLoginVO(u *model.SysUser) (*LoginVO, error) {
	access, err := s.jwt.GenerateAccessToken(u.ID, u.Username, u.Role)
	if err != nil {
		return nil, err
	}
	refresh, err := s.jwt.GenerateRefreshToken(u.ID)
	if err != nil {
		return nil, err
	}
	return &LoginVO{
		AccessToken:  access,
		RefreshToken: refresh,
		ExpiresIn:    s.jwt.AccessTTL(),
		UserInfo:     s.toUserVO(u),
	}, nil
}

// toUserVO 映射用户视图。第三方登录用户的团队加价系数恒为 1（不接入 team 模块）。
func (s *Service) toUserVO(u *model.SysUser) *UserVO {
	return &UserVO{
		ID:              u.PublicID,
		Username:        u.Username,
		Email:           u.Email,
		Phone:           u.Phone,
		Nickname:        u.Nickname,
		Avatar:          u.Avatar,
		Role:            u.Role,
		Status:          u.Status,
		APIQuota:        u.APIQuota,
		Points:          u.Points,
		IsAuthor:        u.IsAuthor,
		StorageQuota:    u.StorageQuota,
		InTeam:          u.TeamID != nil,
		TeamPriceFactor: decimal.NewFromInt(1),
		CreateTime:      u.CreateTime,
		LastLoginTime:   u.LastLoginTime,
	}
}

func (s *Service) errorf(format string, args ...interface{}) {
	if s.logger != nil {
		s.logger.Errorf(format, args...)
	}
}
