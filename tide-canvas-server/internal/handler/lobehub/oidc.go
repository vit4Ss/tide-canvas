package lobehub

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"html"
	"math/big"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"gorm.io/gorm"
	"tidecanvas/internal/middleware"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
)

type authorization struct {
	RedirectURI string `json:"redirect_uri"`
	State       string `json:"state"`
	Challenge   string `json:"code_challenge"`
	Nonce       string `json:"nonce"`
}
type accessClaims struct {
	Use string `json:"token_use"`
	jwt.RegisteredClaims
}

func oauthError(c *gin.Context, code string) {
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusBadRequest, gin.H{"error": code})
}
func (s *service) discovery(c *gin.Context) {
	c.JSON(200, gin.H{"issuer": s.cfg.IssuerURL, "authorization_endpoint": s.cfg.IssuerURL + "/authorize", "token_endpoint": s.cfg.IssuerURL + "/token", "userinfo_endpoint": s.cfg.IssuerURL + "/userinfo", "jwks_uri": s.cfg.IssuerURL + "/jwks",
		"response_types_supported": []string{"code"}, "grant_types_supported": []string{"authorization_code"}, "subject_types_supported": []string{"public"}, "id_token_signing_alg_values_supported": []string{"RS256"}, "token_endpoint_auth_methods_supported": []string{"client_secret_basic", "client_secret_post"}, "code_challenge_methods_supported": []string{"S256"}, "scopes_supported": []string{"openid", "profile", "email"}})
}
func (s *service) jwks(c *gin.Context) {
	c.JSON(200, gin.H{"keys": []any{gin.H{"kty": "RSA", "alg": "RS256", "use": "sig", "kid": s.kid, "n": base64.RawURLEncoding.EncodeToString(s.signer.N.Bytes()), "e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(s.signer.E)).Bytes())}}})
}
func (s *service) validRedirect(uri string) bool {
	return uri == s.cfg.PublicURL+"/api/auth/callback/generic-oidc" || uri == s.cfg.PublicURL+"/api/auth/oauth2/callback/generic-oidc"
}
func (s *service) authorize(c *gin.Context) {
	q := c.Request.URL.Query()
	scopes := strings.Fields(q.Get("scope"))
	hasOpenID := false
	for _, scope := range scopes {
		if scope == "openid" {
			hasOpenID = true
		}
		if scope != "openid" && scope != "profile" && scope != "email" {
			oauthError(c, "invalid_scope")
			return
		}
	}
	challenge := q.Get("code_challenge")
	decoded, err := base64.RawURLEncoding.DecodeString(challenge)
	if q.Get("client_id") != s.cfg.ClientID || q.Get("response_type") != "code" || !s.validRedirect(q.Get("redirect_uri")) || !hasOpenID || q.Get("code_challenge_method") != "S256" || err != nil || len(decoded) != 32 || len(q.Get("state")) > 2048 || len(q.Get("nonce")) > 256 {
		oauthError(c, "invalid_request")
		return
	}
	if q.Get("prompt") == "none" { // Main-site authentication uses its own browser session.
		u, _ := url.Parse(q.Get("redirect_uri"))
		v := u.Query()
		v.Set("error", "login_required")
		v.Set("state", q.Get("state"))
		u.RawQuery = v.Encode()
		c.Redirect(302, u.String())
		return
	}
	a := authorization{RedirectURI: q.Get("redirect_uri"), State: q.Get("state"), Challenge: challenge, Nonce: q.Get("nonce")}
	request, err := s.putGrant(s.d.DB.WithContext(c.Request.Context()), "authorize", 0, a, 10*time.Minute)
	if err != nil {
		oauthError(c, "server_error")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.Header("Referrer-Policy", "no-referrer")
	redirectToLogin(c, s.mainOrigin+"/ai-chat/authorize?request="+url.QueryEscape(request))
}

// redirectToLogin sends the browser on to the main site's approval page.
//
// This hop happens inside the chat iframe, and a browser that declines to
// follow the 302 there renders the response body instead — with Go's default
// body that is the word "Found" on a blank page, which tells the user nothing
// and leaves them stuck. So the body carries the same destination as a meta
// refresh and as a link the user can click. Clients that do follow the
// redirect never see any of it.
func redirectToLogin(c *gin.Context, target string) {
	c.Header("Location", target)
	c.Header("Content-Type", "text/html; charset=utf-8")
	escaped := html.EscapeString(target)
	c.String(302, "<!doctype html><html lang=\"zh-CN\"><meta charset=\"utf-8\">"+
		"<meta http-equiv=\"refresh\" content=\"0;url="+escaped+"\">"+
		"<title>正在登录 AI 聊天</title>"+
		"<body style=\"margin:0;background:#0c0d10;color:#e8edf1;font:15px system-ui;display:grid;place-items:center;min-height:100vh\">"+
		"<p>正在跳转到主站登录…<br><a style=\"color:#49cde0\" href=\""+escaped+"\">如果没有自动跳转，请点这里继续</a></p>")
}
func (s *service) approve(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2048)
	var input struct {
		Request string `json:"request"`
	}
	if c.ShouldBindJSON(&input) != nil {
		response.Fail(c, 400, "登录请求无效")
		return
	}
	uid := middleware.CurrentUserID(c)
	if _, err := s.active(c.Request.Context(), uid); err != nil {
		response.Fail(c, 403, "账号不可用")
		return
	}
	grant, err := s.grant(c.Request.Context(), "authorize", input.Request)
	if err != nil {
		response.Fail(c, 400, "登录请求已过期，请重新进入 AI 聊天")
		return
	}
	var a authorization
	if json.Unmarshal([]byte(grant.Payload), &a) != nil || !s.validRedirect(a.RedirectURI) {
		response.Fail(c, 400, "登录请求无效")
		return
	}
	var code string
	err = s.d.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		if err := consume(tx, grant); err != nil {
			return err
		}
		var err error
		code, err = s.putGrant(tx, "code", uid, a, 2*time.Minute)
		return err
	})
	if err != nil {
		response.Fail(c, 400, "登录请求已使用，请重新进入 AI 聊天")
		return
	}
	u, _ := url.Parse(a.RedirectURI)
	q := u.Query()
	q.Set("code", code)
	q.Set("state", a.State)
	u.RawQuery = q.Encode()
	c.Header("Cache-Control", "no-store")
	response.OK(c, gin.H{"url": u.String()})
}
func secretEqual(a, b string) bool {
	x := sha256.Sum256([]byte(a))
	y := sha256.Sum256([]byte(b))
	return subtle.ConstantTimeCompare(x[:], y[:]) == 1
}
func (s *service) sign(claims jwt.Claims) (string, error) {
	t := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	t.Header["kid"] = s.kid
	return t.SignedString(s.signer)
}
func (s *service) profile(user *model.User) gin.H {
	// A non-guessable alias avoids merging an unverified local LobeHub account
	// by email. Identity is the stable OIDC subject; no email delivery is claimed.
	mac := hmac.New(sha256.New, []byte(s.cfg.ClientSecret))
	mac.Write([]byte("lobehub-email:" + user.ID.String()))
	alias := base64.RawURLEncoding.EncodeToString(mac.Sum(nil)[:18]) + "@identity.tidecanvas.invalid"
	name := user.Nickname
	if name == "" {
		name = user.Username
	}
	return gin.H{"sub": user.ID.String(), "name": name, "preferred_username": user.Username, "email": alias, "email_verified": false, "picture": user.Avatar}
}
func (s *service) token(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	c.Header("Pragma", "no-cache")
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 8192)
	if c.Request.ParseForm() != nil {
		oauthError(c, "invalid_request")
		return
	}
	client, secret, ok := c.Request.BasicAuth()
	if !ok {
		client = c.PostForm("client_id")
		secret = c.PostForm("client_secret")
	}
	if client != s.cfg.ClientID || !secretEqual(secret, s.cfg.ClientSecret) {
		c.JSON(401, gin.H{"error": "invalid_client"})
		return
	}
	if c.PostForm("grant_type") != "authorization_code" {
		oauthError(c, "unsupported_grant_type")
		return
	}
	grant, err := s.grant(c.Request.Context(), "code", c.PostForm("code"))
	if err != nil {
		oauthError(c, "invalid_grant")
		return
	}
	var a authorization
	_ = json.Unmarshal([]byte(grant.Payload), &a)
	verifier := c.PostForm("code_verifier")
	sum := sha256.Sum256([]byte(verifier))
	if len(verifier) < 43 || len(verifier) > 128 || c.PostForm("redirect_uri") != a.RedirectURI || !secretEqual(base64.RawURLEncoding.EncodeToString(sum[:]), a.Challenge) {
		oauthError(c, "invalid_grant")
		return
	}
	user, err := s.active(c.Request.Context(), grant.UserID)
	if err != nil {
		oauthError(c, "invalid_grant")
		return
	}
	now := time.Now()
	claims := jwt.RegisteredClaims{Issuer: s.cfg.IssuerURL, Subject: user.ID.String(), Audience: jwt.ClaimStrings{s.cfg.ClientID}, IssuedAt: jwt.NewNumericDate(now), ExpiresAt: jwt.NewNumericDate(now.Add(5 * time.Minute))}
	access, err := s.sign(accessClaims{Use: "userinfo", RegisteredClaims: claims})
	if err != nil {
		oauthError(c, "server_error")
		return
	}
	idClaims := jwt.MapClaims(s.profile(user))
	idClaims["iss"] = claims.Issuer
	idClaims["aud"] = s.cfg.ClientID
	idClaims["iat"] = now.Unix()
	idClaims["exp"] = now.Add(5 * time.Minute).Unix()
	if a.Nonce != "" {
		idClaims["nonce"] = a.Nonce
	}
	idToken, err := s.sign(idClaims)
	if err != nil {
		oauthError(c, "server_error")
		return
	}
	if err := consume(s.d.DB.WithContext(c.Request.Context()), grant); err != nil {
		oauthError(c, "invalid_grant")
		return
	}
	c.JSON(200, gin.H{"access_token": access, "id_token": idToken, "token_type": "Bearer", "expires_in": 300, "scope": "openid profile email"})
}
func (s *service) userinfo(c *gin.Context) {
	c.Header("Cache-Control", "no-store")
	header := strings.Fields(c.GetHeader("Authorization"))
	if len(header) != 2 || !strings.EqualFold(header[0], "Bearer") {
		c.JSON(401, gin.H{"error": "invalid_token"})
		return
	}
	claims := &accessClaims{}
	_, err := jwt.ParseWithClaims(header[1], claims, func(*jwt.Token) (any, error) { return &s.signer.PublicKey, nil }, jwt.WithValidMethods([]string{"RS256"}), jwt.WithIssuer(s.cfg.IssuerURL), jwt.WithAudience(s.cfg.ClientID), jwt.WithExpirationRequired())
	var uid idgen.ID
	if err != nil || claims.Use != "userinfo" || json.Unmarshal([]byte(`"`+claims.Subject+`"`), &uid) != nil {
		c.JSON(401, gin.H{"error": "invalid_token"})
		return
	}
	u, err := s.active(c.Request.Context(), uid)
	if err != nil {
		c.JSON(401, gin.H{"error": "invalid_token"})
		return
	}
	c.JSON(200, s.profile(u))
}
