package lobehub

import (
	"bytes"
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"io"
	"net/http"
	"net/url"
	"time"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"tidecanvas/internal/middleware"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/logger"
	"tidecanvas/internal/pkg/response"
)

//go:embed bridge.html
var bridgeHTML string

func (s *service) launch(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2048)
	uid := middleware.CurrentUserID(c)
	var input struct {
		AccountID string `json:"accountId"`
	}
	if c.ShouldBindJSON(&input) != nil {
		response.Fail(c, 400, "请求格式无效")
		return
	}
	if input.AccountID != uid.String() {
		response.Fail(c, 409, "登录账号已变化，请刷新页面")
		return
	}
	if _, err := s.active(c.Request.Context(), uid); err != nil {
		response.Fail(c, 403, "账号不可用")
		return
	}
	key, err := s.d.UserKeys.Ensure(c.Request.Context(), uid)
	if err != nil {
		response.Fail(c, 500, "暂时无法准备聊天账号")
		return
	}
	if key.DisabledAt != nil {
		response.Fail(c, 403, "默认 API Key 已停用，请先在个人中心启用")
		return
	}
	ticket, err := s.putGrant(s.d.DB.WithContext(c.Request.Context()), "launch", uid, nil, 10*time.Minute)
	if err != nil {
		response.Fail(c, 500, "暂时无法连接 AI 聊天")
		return
	}
	c.Header("Cache-Control", "no-store")
	response.OK(c, gin.H{"url": s.cfg.PublicURL + "/flowinglight/connect?ticket=" + url.QueryEscape(ticket)})
}
func (s *service) bridge(c *gin.Context) {
	ticket := c.Query("ticket")
	if len(ticket) != 43 {
		c.String(400, "请从主站重新进入 AI 聊天")
		return
	}
	nonce, err := randomHandle()
	if err != nil {
		c.String(503, "暂时无法建立安全连接")
		return
	}
	c.Header("Content-Type", "text/html; charset=utf-8")
	c.Header("Cache-Control", "no-store")
	c.Header("Referrer-Policy", "no-referrer")
	// The main site embeds the chat in an iframe, so it is the one permitted
	// ancestor. X-Frame-Options has no origin list (ALLOW-FROM is dead), so the
	// restriction is expressed with frame-ancestors alone.
	c.Header("Content-Security-Policy", "default-src 'none'; script-src 'nonce-"+nonce+"'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors "+s.mainOrigin+"; base-uri 'none'")
	data, _ := json.Marshal(gin.H{"ticket": ticket, "mainURL": s.mainOrigin + "/ai-chat", "lobeURL": s.cfg.PublicURL, "afterSSO": c.Query("sso") == "1"})
	t := template.Must(template.New("bridge").Parse(bridgeHTML))
	_ = t.Execute(c.Writer, struct {
		Nonce  string
		Config template.JS
	}{nonce, template.JS(data)})
}

func (s *service) lobeCall(ctx context.Context, cookie, method, path string, input any) (json.RawMessage, int, error) {
	var body io.Reader
	if input != nil {
		raw, err := json.Marshal(input)
		if err != nil {
			return nil, 0, err
		}
		body = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, s.cfg.InternalURL+path, body)
	if err != nil {
		return nil, 0, err
	}
	public, _ := url.Parse(s.cfg.PublicURL)
	req.Host = public.Host
	req.Header.Set("Cookie", cookie)
	req.Header.Set("Origin", s.cfg.PublicURL)
	req.Header.Set("Referer", s.cfg.PublicURL+"/")
	req.Header.Set("X-Forwarded-Proto", public.Scheme)
	req.Header.Set("Content-Type", "application/json")
	resp, err := s.http.Do(req)
	if err != nil {
		return nil, 0, errors.New("LobeHub connection failed")
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return nil, resp.StatusCode, errors.New("LobeHub response failed")
	}
	return raw, resp.StatusCode, nil
}
func (s *service) rpc(ctx context.Context, cookie, procedure string, input any) error {
	data, status, err := s.lobeCall(ctx, cookie, "POST", "/trpc/lambda/"+procedure, map[string]any{"json": input})
	if err != nil {
		return err
	}
	var result struct {
		Error  json.RawMessage `json:"error"`
		Result json.RawMessage `json:"result"`
	}
	if json.Unmarshal(data, &result) != nil || status < 200 || status >= 300 || len(result.Error) > 0 || len(result.Result) == 0 {
		// Never relay raw RPC errors; their input may include the user's API key.
		return fmt.Errorf("LobeHub interface %s failed (HTTP %d)", procedure, status)
	}
	return nil
}

func (s *service) rpcQuery(ctx context.Context, cookie, procedure string, input any) (json.RawMessage, error) {
	encoded, _ := json.Marshal(gin.H{"json": input})
	raw, status, err := s.lobeCall(ctx, cookie, "GET", "/trpc/lambda/"+procedure+"?input="+url.QueryEscape(string(encoded)), nil)
	if err != nil {
		return nil, err
	}
	var out struct {
		Error  json.RawMessage `json:"error"`
		Result struct {
			Data struct {
				JSON json.RawMessage `json:"json"`
			} `json:"data"`
		} `json:"result"`
	}
	if status != 200 || json.Unmarshal(raw, &out) != nil || len(out.Error) > 0 {
		return nil, fmt.Errorf("LobeHub query %s failed", procedure)
	}
	return out.Result.Data.JSON, nil
}
func (s *service) lobeIdentity(ctx context.Context, cookie string) (string, []string, error) {
	if cookie == "" || len(cookie) > 16384 {
		return "", nil, errLobeLogin
	}
	raw, status, err := s.lobeCall(ctx, cookie, "GET", "/api/auth/get-session", nil)
	var session struct {
		User struct {
			ID string `json:"id"`
		} `json:"user"`
	}
	if err != nil || status >= 500 {
		return "", nil, errLobeUnavailable
	}
	if status == 401 || status == 403 {
		return "", nil, errLobeLogin
	}
	if status != 200 || json.Unmarshal(raw, &session) != nil {
		return "", nil, errLobeUnavailable
	}
	if session.User.ID == "" {
		return "", nil, errLobeLogin
	}
	raw, status, err = s.lobeCall(ctx, cookie, "GET", "/api/auth/list-accounts", nil)
	var accounts []struct {
		ProviderID string `json:"providerId"`
		AccountID  string `json:"accountId"`
	}
	if err != nil || status != 200 || json.Unmarshal(raw, &accounts) != nil {
		if status == 401 || status == 403 {
			return "", nil, errLobeLogin
		}
		return "", nil, errLobeUnavailable
	}
	subjects := []string{}
	for _, account := range accounts {
		if account.ProviderID == "generic-oidc" {
			subjects = append(subjects, account.AccountID)
		}
	}
	return session.User.ID, subjects, nil
}
func (s *service) bind(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Minute)
	defer cancel()
	c.Request = c.Request.WithContext(ctx)
	c.Header("Cache-Control", "no-store")
	if c.GetHeader("Origin") != s.cfg.PublicURL {
		c.JSON(403, gin.H{"error": "ORIGIN_DENIED", "message": "请从主站重新进入 AI 聊天"})
		return
	}
	var input struct {
		Ticket string `json:"ticket"`
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2048)
	if c.ShouldBindJSON(&input) != nil {
		c.JSON(400, gin.H{"message": "连接请求无效"})
		return
	}
	grant, err := s.grant(c.Request.Context(), "launch", input.Ticket)
	if err != nil {
		c.JSON(410, gin.H{"message": "连接已过期，请返回主站重试"})
		return
	}
	lobeID, subjects, err := s.lobeIdentity(c.Request.Context(), c.GetHeader("Cookie"))
	if err != nil {
		if !errors.Is(err, errLobeLogin) {
			c.JSON(503, gin.H{"message": "聊天登录服务暂时不可用，请稍后重试"})
			return
		}
		c.JSON(401, gin.H{"error": "LOGIN_REQUIRED"})
		return
	}
	matched := false
	for _, subject := range subjects {
		if subject == grant.UserID.String() {
			matched = true
		}
	}
	if !matched {
		c.JSON(409, gin.H{"error": "ACCOUNT_MISMATCH", "message": "正在切换到主站账号"})
		return
	}
	if _, err := s.active(c.Request.Context(), grant.UserID); err != nil {
		c.JSON(403, gin.H{"message": "主站账号不可用"})
		return
	}
	routes, err := s.offeredModels(c.Request.Context())
	if err != nil || len(routes) == 0 {
		c.JSON(503, gin.H{"message": "主站暂未开放 AI 聊天模型，请在后台配置供应商与模型单价"})
		return
	}
	// Claim before configuration so simultaneous tabs cannot race two different
	// users into a provider setup. Failed setup is retried with a fresh launch.
	firstBinding := false
	err = s.d.DB.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		if err := consume(tx, grant); err != nil {
			return err
		}
		candidate := model.LobeHubLink{UserID: grant.UserID, LobeUserID: lobeID}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&candidate).Error; err != nil {
			return err
		}
		var existing model.LobeHubLink
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&existing, "user_id = ?", grant.UserID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return errMapping
			}
			return err
		}
		if existing.LobeUserID != lobeID {
			return errMapping
		}
		if existing.SyncUntil != nil && existing.SyncUntil.After(time.Now()) {
			return errBindingBusy
		}
		firstBinding = existing.ConnectedAt == nil
		// The lease outlives the entire two-minute request deadline. It also
		// serializes separate main-site instances without holding a DB transaction
		// open while making remote RPCs.
		return tx.Model(&existing).Updates(map[string]any{"sync_token": grant.Hash, "sync_until": time.Now().Add(3 * time.Minute)}).Error
	})
	if err != nil {
		if errors.Is(err, errBindingBusy) {
			c.Header("Retry-After", "5")
			c.JSON(409, gin.H{"error": "SYNC_IN_PROGRESS", "message": "另一个页面正在同步聊天账号，请稍后从主站重新连接"})
			return
		}
		if errors.Is(err, errMapping) {
			c.JSON(409, gin.H{"message": "聊天账号已存在不同的主站绑定，请联系管理员核对"})
			return
		}
		if errors.Is(err, errGrant) {
			c.JSON(410, gin.H{"message": "连接请求已使用，请返回主站重试"})
		} else {
			c.JSON(503, gin.H{"message": "暂时无法锁定聊天配置，请稍后重试"})
		}
		return
	}
	defer func() {
		cleanup, done := context.WithTimeout(context.Background(), 5*time.Second)
		defer done()
		_ = s.d.DB.WithContext(cleanup).Model(&model.LobeHubLink{}).Where("user_id = ? AND sync_token = ?", grant.UserID, grant.Hash).Updates(map[string]any{"sync_token": "", "sync_until": nil}).Error
	}()
	// Read the key only after obtaining the lease: a waiting/newer connection
	// must never reuse a credential captured before another request's rotation.
	keyRow, err := s.d.UserKeys.Ensure(ctx, grant.UserID)
	if err != nil || keyRow.DisabledAt != nil {
		c.JSON(403, gin.H{"message": "请先在主站个人中心启用默认 API Key"})
		return
	}
	key, err := s.d.UserKeys.Reveal(ctx, grant.UserID, keyRow.Revision)
	if err != nil {
		c.JSON(503, gin.H{"message": "暂时无法读取默认 API Key"})
		return
	}
	cookie := c.GetHeader("Cookie")
	provider := "flowinglight"
	// updateConfig is an upsert; updateAiProvider supplies the custom SDK metadata.
	steps := []struct {
		name  string
		input any
	}{
		{"aiProvider.updateAiProviderConfig", gin.H{"id": provider, "value": gin.H{"keyVaults": gin.H{"apiKey": key, "baseURL": s.mainOrigin + "/api/integrations/v1"}, "fetchOnClient": false, "config": gin.H{"enableResponseApi": false}, "checkModel": routes[0].model.ModelKey}}},
		{"aiProvider.updateAiProvider", gin.H{"id": provider, "value": gin.H{"name": "流光主站", "description": "使用主站积分的模型服务", "settings": gin.H{"sdkType": "openai", "showModelFetcher": true, "supportResponsesApi": false}}}},
		{"aiProvider.toggleProviderEnabled", gin.H{"id": provider, "enabled": true}},
	}
	for _, step := range steps {
		if err = s.rpc(c.Request.Context(), cookie, step.name, step.input); err != nil {
			break
		}
	}
	if err == nil {
		items := []any{}
		ids := []string{}
		for i := range routes {
			r := &routes[i]
			items = append(items, gin.H{"id": r.model.ModelKey, "type": "chat", "displayName": r.displayName(), "enabled": true, "source": "remote", "abilities": gin.H{"functionCall": s.cfg.SupportsTools, "vision": r.model.Vision}})
			ids = append(ids, r.model.ModelKey)
		}
		err = s.rpc(c.Request.Context(), cookie, "aiModel.batchUpdateAiModels", gin.H{"id": provider, "models": items})
		if err == nil {
			err = s.rpc(c.Request.Context(), cookie, "aiModel.batchToggleAiModels", gin.H{"id": provider, "models": ids, "enabled": true})
		}
		if err == nil {
			s.hideForeignProviders(c.Request.Context(), cookie, provider)
		}
		if err == nil && firstBinding {
			systemAgents := gin.H{}
			for _, name := range []string{"topic", "historyCompress", "translation", "agentMeta", "thread", "generationTopic", "followUpAction", "inputCompletion", "promptRewrite", "topicAutoSummary", "goal", "expertise", "onboardingUnderstanding", "onboardingTaskRecommender"} {
				// Keep explicit translation/rewrite actions available, while avoiding
				// automatic title, suggestion and compression calls on first entry.
				enabled := name == "translation" || name == "promptRewrite"
				systemAgents[name] = gin.H{"model": routes[0].model.ModelKey, "provider": provider, "enabled": enabled}
			}
			err = s.rpc(c.Request.Context(), cookie, "user.updateSettings", gin.H{"defaultAgent": gin.H{"config": gin.H{"model": routes[0].model.ModelKey, "provider": provider}}, "general": gin.H{"language": "zh-CN"}, "systemAgent": systemAgents})
			if err == nil {
				raw, queryErr := s.rpcQuery(c.Request.Context(), cookie, "agent.getBuiltinAgent", gin.H{"slug": "inbox"})
				var inbox struct {
					ID string `json:"id"`
				}
				if queryErr != nil || json.Unmarshal(raw, &inbox) != nil || inbox.ID == "" {
					err = errors.New("LobeHub inbox configuration unavailable")
				} else {
					err = s.rpc(c.Request.Context(), cookie, "agent.updateAgentConfig", gin.H{"agentId": inbox.ID, "value": gin.H{"model": routes[0].model.ModelKey, "provider": provider}})
				}
			}
		}
	}
	if err != nil {
		c.JSON(502, gin.H{"message": "LobeHub 配置同步失败，请从主站重试；若持续失败请检查对接版本"})
		return
	}
	currentKey, keyErr := s.d.UserKeys.Ensure(c.Request.Context(), grant.UserID)
	if keyErr != nil || currentKey.DisabledAt != nil || currentKey.Revision != keyRow.Revision {
		c.JSON(409, gin.H{"message": "主站 Key 已变化，请重新连接 AI 聊天以同步最新密钥"})
		return
	}
	if _, err := s.active(ctx, grant.UserID); err != nil {
		c.JSON(403, gin.H{"message": "主站账号不可用"})
		return
	}
	saved := s.d.DB.WithContext(ctx).Model(&model.LobeHubLink{}).Where("user_id = ? AND lobe_user_id = ? AND sync_token = ? AND sync_until > ?", grant.UserID, lobeID, grant.Hash, time.Now()).Updates(map[string]any{"key_revision": keyRow.Revision, "connected_at": time.Now(), "sync_token": "", "sync_until": nil})
	if saved.Error != nil || saved.RowsAffected != 1 {
		c.JSON(409, gin.H{"message": "聊天账号映射冲突，请联系管理员"})
		return
	}
	c.JSON(200, gin.H{"ok": true, "url": s.cfg.PublicURL, "provider": provider})
}

// hideForeignProviders leaves the main-site provider as the only one offering
// models. LobeHub ships its built-in providers enabled and keyless, so their
// catalogues otherwise fill the picker with models that cannot run and never
// bill main-site points.
//
// The list is read at runtime rather than hard-coded: the built-in set changes
// between LobeHub releases. A provider the release protects from being disabled
// refuses the call, which is not a reason to fail the user's connection — the
// remaining providers are still hidden.
func (s *service) hideForeignProviders(ctx context.Context, cookie, keep string) {
	raw, err := s.rpcQuery(ctx, cookie, "aiProvider.getAiProviderList", nil)
	if err != nil {
		logger.L().Warn("could not read the LobeHub provider list", zap.Error(err))
		return
	}
	var rows []struct {
		ID      string `json:"id"`
		Enabled *bool  `json:"enabled"`
	}
	if json.Unmarshal(raw, &rows) != nil {
		logger.L().Warn("unexpected LobeHub provider list shape")
		return
	}
	for _, row := range rows {
		if row.ID == "" || row.ID == keep || (row.Enabled != nil && !*row.Enabled) {
			continue
		}
		if err := s.rpc(ctx, cookie, "aiProvider.toggleProviderEnabled", gin.H{"id": row.ID, "enabled": false}); err != nil {
			logger.L().Info("LobeHub kept a provider enabled", zap.String("provider", row.ID))
		}
	}
}
