package admin

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"tidecanvas/internal/app"
	"tidecanvas/internal/middleware"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/chatupstream"
	"tidecanvas/internal/pkg/eventlog"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
	"tidecanvas/internal/pkg/tokenbilling"
)

// g3_chat_providers.go is the AI chat supply chain: third-party OpenAI-compatible
// services and their credentialed addresses (several per provider, tried in
// order). Model discovery and pricing live in g3_chat_models.go.
//
// This is deliberately separate from 模型管理 — nothing here reaches 创作台
// generation, and generation never reads these tables.

type chatProvidersHandler struct {
	db     *gorm.DB
	vault  chatupstream.Vault
	client *http.Client
}

// discoveryClient is what model discovery calls providers with. The same dial
// policy as the chat gateway (chatupstream.NewTransport), so an address that
// works here works in a conversation and one refused here is refused there.
// Redirects are not followed: the credential must not ride along to wherever
// a relay points. Tests build the handler with this too, so a fixture cannot
// quietly differ from production in how it reaches a provider.
func discoveryClient() *http.Client {
	return &http.Client{
		Timeout:       30 * time.Second,
		Transport:     chatupstream.NewTransport(),
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
}

func RegisterChatProviders(g *gin.RouterGroup, d *app.Deps) {
	h := &chatProvidersHandler{
		db:     d.DB,
		vault:  chatupstream.New(d.Cfg.JWT.Secret),
		client: discoveryClient(),
	}
	g.GET("/chat-providers", h.list)
	g.POST("/chat-providers", h.createProvider)
	g.PUT("/chat-providers/:id", h.updateProvider)
	g.DELETE("/chat-providers/:id", h.deleteProvider)

	g.POST("/chat-providers/:id/endpoints", h.createEndpoint)
	g.PUT("/chat-endpoints/:id", h.updateEndpoint)
	g.DELETE("/chat-endpoints/:id", h.deleteEndpoint)

	g.POST("/chat-providers/:id/fetch-models", h.fetchModels)
	g.PUT("/chat-models/:id", h.updateModel)
	g.POST("/chat-models/:id/prefer", h.preferModel)
	g.DELETE("/chat-models/:id", h.deleteModel)
}

// ---- VOs ----

type chatEndpointVO struct {
	ID           idgen.ID   `json:"id"`
	Label        string     `json:"label"`
	BaseUrl      string     `json:"baseUrl"`
	HasApiKey    bool       `json:"hasApiKey"`
	Enabled      bool       `json:"enabled"`
	SortOrder    int        `json:"sortOrder"`
	LastOkAt     *time.Time `json:"lastOkAt"`
	LastFailedAt *time.Time `json:"lastFailedAt"`
	LastFailure  string     `json:"lastFailure"`
}

type chatModelVO struct {
	ID         idgen.ID              `json:"id"`
	ModelKey   string                `json:"modelKey"`
	Name       string                `json:"name"`
	Enabled    bool                  `json:"enabled"`
	SortOrder  int                   `json:"sortOrder"`
	Vision     bool                  `json:"vision"`
	Pricing    *tokenbilling.Pricing `json:"pricing"`
	PriceError string                `json:"priceError"`
	// EffectivePricing is Pricing scaled by the provider's multiplier — the
	// rates the gateway actually sells at. Equal to Pricing when the provider
	// has no multiplier; null whenever Pricing is.
	EffectivePricing *tokenbilling.Pricing `json:"effectivePricing"`
	// Priority is this row's rank among the providers offering the same key.
	// Preferred says whether routing would pick this row for the key; Rivals is
	// how many other rows for the key could serve it (enabled, priced, under an
	// enabled provider). The page shows the preference control only when
	// Rivals is above zero — a model one provider offers has nothing to choose.
	Priority  int  `json:"priority"`
	Preferred bool `json:"preferred"`
	Rivals    int  `json:"rivals"`
}

type chatProviderVO struct {
	ID        idgen.ID         `json:"id"`
	Name      string           `json:"name"`
	Enabled   bool             `json:"enabled"`
	SortOrder int              `json:"sortOrder"`
	Remark    string           `json:"remark"`
	Endpoints []chatEndpointVO `json:"endpoints"`
	Models    []chatModelVO    `json:"models"`
	// DefaultPricing is what newly discovered models start with; null when the
	// provider has none. PriceMultiplier is the raw decimal string ("" = 1).
	DefaultPricing  *tokenbilling.Pricing `json:"defaultPricing"`
	PriceMultiplier string                `json:"priceMultiplier"`
}

func (h *chatProvidersHandler) list(c *gin.Context) {
	ctx := c.Request.Context()
	var providers []model.ChatProvider
	if err := h.db.WithContext(ctx).Order("sort_order ASC, id ASC").Find(&providers).Error; err != nil {
		response.Fail(c, response.CodeServerError, "读取供应商失败")
		return
	}
	var endpoints []model.ChatEndpoint
	if err := h.db.WithContext(ctx).Order("sort_order ASC, id ASC").Find(&endpoints).Error; err != nil {
		response.Fail(c, response.CodeServerError, "读取接入地址失败")
		return
	}
	var models []model.ChatModel
	if err := h.db.WithContext(ctx).Order(model.ChatModelOrder).Find(&models).Error; err != nil {
		response.Fail(c, response.CodeServerError, "读取模型失败")
		return
	}

	byProvider := map[idgen.ID]*chatProviderVO{}
	providerRows := map[idgen.ID]model.ChatProvider{}
	out := make([]*chatProviderVO, 0, len(providers))
	for _, p := range providers {
		vo := &chatProviderVO{
			ID: p.ID, Name: p.Name, Enabled: p.Enabled, SortOrder: p.SortOrder, Remark: p.Remark,
			Endpoints: []chatEndpointVO{}, Models: []chatModelVO{},
			PriceMultiplier: strings.TrimSpace(p.PriceMultiplier),
		}
		if defaults, err := tokenbilling.Parse(p.DefaultPricing); err == nil {
			vo.DefaultPricing = defaults
		}
		byProvider[p.ID] = vo
		providerRows[p.ID] = p
		out = append(out, vo)
	}
	for _, e := range endpoints {
		vo, ok := byProvider[e.ProviderID]
		if !ok {
			continue
		}
		// hasApiKey only: the credential itself never leaves the server.
		vo.Endpoints = append(vo.Endpoints, chatEndpointVO{
			ID: e.ID, Label: e.Label, BaseUrl: e.BaseURL,
			HasApiKey: strings.TrimSpace(e.APIKey) != "", Enabled: e.Enabled, SortOrder: e.SortOrder,
			LastOkAt: e.LastOkAt, LastFailedAt: e.LastFailedAt, LastFailure: e.LastFailure,
		})
	}
	// Which row serves each key is decided across providers, in the same order
	// the router uses (model.ChatModelOrder); the list is loaded in that order
	// so the first eligible row per key is the preferred one.
	enabledProvider := map[idgen.ID]bool{}
	for _, p := range providers {
		enabledProvider[p.ID] = p.Enabled
	}
	eligible := map[string][]idgen.ID{}
	for _, m := range models {
		if m.Enabled && enabledProvider[m.ProviderID] {
			if _, err := tokenbilling.Parse(m.Pricing); err == nil {
				eligible[m.ModelKey] = append(eligible[m.ModelKey], m.ID)
			}
		}
	}
	for _, m := range models {
		vo, ok := byProvider[m.ProviderID]
		if !ok {
			continue
		}
		item := toChatModelVO(m)
		item.Priority = m.Priority
		if item.Pricing != nil {
			// The same scaling the gateway applies; a bad multiplier shows as
			// no effective price, which is also how the gateway treats it.
			if multiplier, err := tokenbilling.ParseMultiplier(providerRows[m.ProviderID].PriceMultiplier); err == nil {
				item.EffectivePricing, _ = item.Pricing.Scaled(multiplier)
			}
		}
		if rows := eligible[m.ModelKey]; len(rows) > 0 {
			item.Preferred = rows[0] == m.ID
			item.Rivals = len(rows)
			for _, id := range rows {
				if id == m.ID {
					item.Rivals--
					break
				}
			}
		}
		vo.Models = append(vo.Models, item)
	}
	response.OK(c, out)
}

// ---- providers ----

type chatProviderDTO struct {
	Name      *string `json:"name" binding:"omitempty,max=64"`
	Enabled   *bool   `json:"enabled"`
	SortOrder *int    `json:"sortOrder"`
	Remark    *string `json:"remark" binding:"omitempty,max=512"`
	// DefaultPricing is the {"tokenPricing":{…}} object, or null to clear.
	DefaultPricing json.RawMessage `json:"defaultPricing"`
	// PriceMultiplier is a decimal string; "" or "1" means sell at list.
	PriceMultiplier *string `json:"priceMultiplier" binding:"omitempty,max=16"`
}

const defaultPricingMessage = "默认单价需要有效的每百万输入/输出 Token 积分（最多六位小数）和 Token 上限"
const multiplierMessage = "倍率需要是大于 0、不超过 100 的数字，最多四位小数；留空表示按原价"

// normalizeDefaultPricing validates a default-pricing payload and returns the
// text to store: "" clears it. A payload with token billing switched off is
// treated as clearing too, since discovery could not use it.
func normalizeDefaultPricing(raw json.RawMessage) (string, bool) {
	text := strings.TrimSpace(string(raw))
	if text == "" || text == "null" {
		return "", true
	}
	if _, err := tokenbilling.Parse(text); err != nil {
		if errors.Is(err, tokenbilling.ErrNotConfigured) {
			return "", true
		}
		return "", false
	}
	return text, true
}

// fillUnpricedModels copies the provider's default pricing into its models that
// have none. It runs when defaults are saved, so an operator who has already
// pulled a catalogue does not have to fill the same numbers into every row.
// Models the operator has priced are left alone.
func (h *chatProvidersHandler) fillUnpricedModels(ctx context.Context, providerID idgen.ID, pricing string) (int64, error) {
	if pricing == "" {
		return 0, nil
	}
	res := h.db.WithContext(ctx).Model(&model.ChatModel{}).
		Where("provider_id = ? AND (pricing IS NULL OR TRIM(pricing) = '')", providerID).
		Update("pricing", pricing)
	return res.RowsAffected, res.Error
}

func (h *chatProvidersHandler) createProvider(c *gin.Context) {
	var dto chatProviderDTO
	if c.ShouldBindJSON(&dto) != nil || dto.Name == nil || strings.TrimSpace(*dto.Name) == "" {
		response.Fail(c, response.CodeBadRequest, "请填写供应商名称")
		return
	}
	row := model.ChatProvider{Name: strings.TrimSpace(*dto.Name), Enabled: true}
	if dto.Enabled != nil {
		row.Enabled = *dto.Enabled
	}
	if dto.SortOrder != nil {
		row.SortOrder = *dto.SortOrder
	}
	if dto.Remark != nil {
		row.Remark = strings.TrimSpace(*dto.Remark)
	}
	if len(dto.DefaultPricing) > 0 {
		pricing, ok := normalizeDefaultPricing(dto.DefaultPricing)
		if !ok {
			response.Fail(c, response.CodeBadRequest, defaultPricingMessage)
			return
		}
		row.DefaultPricing = pricing
	}
	if dto.PriceMultiplier != nil {
		if _, err := tokenbilling.ParseMultiplier(*dto.PriceMultiplier); err != nil {
			response.Fail(c, response.CodeBadRequest, multiplierMessage)
			return
		}
		row.PriceMultiplier = strings.TrimSpace(*dto.PriceMultiplier)
	}
	if err := h.db.WithContext(c.Request.Context()).Create(&row).Error; err != nil {
		response.Fail(c, response.CodeServerError, "创建供应商失败")
		return
	}
	h.audit(c, row.ID, "chat_provider_create", "新增聊天供应商："+row.Name)
	response.OK(c, gin.H{"id": row.ID})
}

func (h *chatProvidersHandler) updateProvider(c *gin.Context) {
	id, ok := g4ParseID(c)
	if !ok {
		return
	}
	var dto chatProviderDTO
	if c.ShouldBindJSON(&dto) != nil {
		response.Fail(c, response.CodeBadRequest, "请求格式无效")
		return
	}
	fields := map[string]any{}
	if dto.Name != nil {
		if strings.TrimSpace(*dto.Name) == "" {
			response.Fail(c, response.CodeBadRequest, "供应商名称不能为空")
			return
		}
		fields["name"] = strings.TrimSpace(*dto.Name)
	}
	if dto.Enabled != nil {
		fields["enabled"] = *dto.Enabled
	}
	if dto.SortOrder != nil {
		fields["sort_order"] = *dto.SortOrder
	}
	if dto.Remark != nil {
		fields["remark"] = strings.TrimSpace(*dto.Remark)
	}
	defaultPricing := ""
	if len(dto.DefaultPricing) > 0 {
		pricing, ok := normalizeDefaultPricing(dto.DefaultPricing)
		if !ok {
			response.Fail(c, response.CodeBadRequest, defaultPricingMessage)
			return
		}
		defaultPricing = pricing
		fields["default_pricing"] = pricing
	}
	if dto.PriceMultiplier != nil {
		if _, err := tokenbilling.ParseMultiplier(*dto.PriceMultiplier); err != nil {
			response.Fail(c, response.CodeBadRequest, multiplierMessage)
			return
		}
		fields["price_multiplier"] = strings.TrimSpace(*dto.PriceMultiplier)
	}
	if len(fields) == 0 {
		response.OK(c, gin.H{"ok": true, "filled": 0})
		return
	}
	if err := h.db.WithContext(c.Request.Context()).Model(&model.ChatProvider{}).Where("id = ?", id).Updates(fields).Error; err != nil {
		response.Fail(c, response.CodeServerError, "保存失败")
		return
	}
	filled, err := h.fillUnpricedModels(c.Request.Context(), id, defaultPricing)
	if err != nil {
		response.Fail(c, response.CodeServerError, "默认单价已保存，但填入未定价模型时失败")
		return
	}
	h.audit(c, id, "chat_provider_update", "修改聊天供应商")
	response.OK(c, gin.H{"ok": true, "filled": filled})
}

// deleteProvider removes the provider together with its addresses and models.
// Leaving those behind would keep credentials for a provider nobody can see.
func (h *chatProvidersHandler) deleteProvider(c *gin.Context) {
	id, ok := g4ParseID(c)
	if !ok {
		return
	}
	err := h.db.WithContext(c.Request.Context()).Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("provider_id = ?", id).Delete(&model.ChatEndpoint{}).Error; err != nil {
			return err
		}
		if err := tx.Where("provider_id = ?", id).Delete(&model.ChatModel{}).Error; err != nil {
			return err
		}
		return tx.Where("id = ?", id).Delete(&model.ChatProvider{}).Error
	})
	if err != nil {
		response.Fail(c, response.CodeServerError, "删除失败")
		return
	}
	h.audit(c, id, "chat_provider_delete", "删除聊天供应商及其地址与模型")
	response.OK(c, gin.H{"ok": true})
}

// ---- endpoints ----

type chatEndpointDTO struct {
	Label     *string `json:"label" binding:"omitempty,max=64"`
	BaseUrl   *string `json:"baseUrl" binding:"omitempty,max=512"`
	ApiKey    *string `json:"apiKey" binding:"omitempty,max=4096"`
	Enabled   *bool   `json:"enabled"`
	SortOrder *int    `json:"sortOrder"`
}

const badBaseURL = "接入地址必须是 http 或 https 开头的完整地址，且不能带账号密码或查询参数"
const internalBaseURL = "接入地址不能指向本机或云元数据地址（127.0.0.1、0.0.0.0、169.254.x.x 等）；内网 IP 可以"

// baseURLMessage tells the operator which rule an address broke. The two are
// different actions: fix the format, or accept that this one is off limits.
func baseURLMessage(err error) string {
	if errors.Is(err, chatupstream.ErrInternalHost) {
		return internalBaseURL
	}
	return badBaseURL
}

func (h *chatProvidersHandler) createEndpoint(c *gin.Context) {
	providerID, ok := g4ParseID(c)
	if !ok {
		return
	}
	var dto chatEndpointDTO
	if c.ShouldBindJSON(&dto) != nil || dto.BaseUrl == nil || dto.ApiKey == nil {
		response.Fail(c, response.CodeBadRequest, "请填写接入地址和 API Key")
		return
	}
	baseURL, err := chatupstream.NormalizeBaseURL(*dto.BaseUrl)
	if err != nil || baseURL == "" {
		response.Fail(c, response.CodeBadRequest, baseURLMessage(err))
		return
	}
	sealed, err := h.vault.Seal(*dto.ApiKey)
	if err != nil {
		response.Fail(c, response.CodeBadRequest, "请填写有效的 API Key")
		return
	}
	if err := h.db.WithContext(c.Request.Context()).First(&model.ChatProvider{}, "id = ?", providerID).Error; err != nil {
		response.Fail(c, response.CodeNotFound, "供应商不存在")
		return
	}
	row := model.ChatEndpoint{ProviderID: providerID, BaseURL: baseURL, APIKey: sealed, Enabled: true}
	if dto.Label != nil {
		row.Label = strings.TrimSpace(*dto.Label)
	}
	if dto.Enabled != nil {
		row.Enabled = *dto.Enabled
	}
	if dto.SortOrder != nil {
		row.SortOrder = *dto.SortOrder
	}
	if err := h.db.WithContext(c.Request.Context()).Create(&row).Error; err != nil {
		response.Fail(c, response.CodeServerError, "创建接入地址失败")
		return
	}
	h.audit(c, row.ID, "chat_endpoint_create", "新增聊天接入地址："+baseURL)
	response.OK(c, gin.H{"id": row.ID})
}

func (h *chatProvidersHandler) updateEndpoint(c *gin.Context) {
	id, ok := g4ParseID(c)
	if !ok {
		return
	}
	var dto chatEndpointDTO
	if c.ShouldBindJSON(&dto) != nil {
		response.Fail(c, response.CodeBadRequest, "请求格式无效")
		return
	}
	fields := map[string]any{}
	if dto.BaseUrl != nil {
		baseURL, err := chatupstream.NormalizeBaseURL(*dto.BaseUrl)
		if err != nil || baseURL == "" {
			response.Fail(c, response.CodeBadRequest, baseURLMessage(err))
			return
		}
		fields["base_url"] = baseURL
	}
	// An untouched key arrives as the mask (or empty) and must survive the save.
	if dto.ApiKey != nil {
		typed := strings.TrimSpace(*dto.ApiKey)
		if typed != "" && typed != chatupstream.Masked {
			sealed, err := h.vault.Seal(typed)
			if err != nil {
				response.Fail(c, response.CodeBadRequest, "请填写有效的 API Key")
				return
			}
			fields["api_key"] = sealed
		}
	}
	if dto.Label != nil {
		fields["label"] = strings.TrimSpace(*dto.Label)
	}
	if dto.Enabled != nil {
		fields["enabled"] = *dto.Enabled
	}
	if dto.SortOrder != nil {
		fields["sort_order"] = *dto.SortOrder
	}
	if len(fields) == 0 {
		response.OK(c, gin.H{"ok": true})
		return
	}
	if err := h.db.WithContext(c.Request.Context()).Model(&model.ChatEndpoint{}).Where("id = ?", id).Updates(fields).Error; err != nil {
		response.Fail(c, response.CodeServerError, "保存失败")
		return
	}
	h.audit(c, id, "chat_endpoint_update", "修改聊天接入地址")
	response.OK(c, gin.H{"ok": true})
}

func (h *chatProvidersHandler) deleteEndpoint(c *gin.Context) {
	id, ok := g4ParseID(c)
	if !ok {
		return
	}
	if err := h.db.WithContext(c.Request.Context()).Where("id = ?", id).Delete(&model.ChatEndpoint{}).Error; err != nil {
		response.Fail(c, response.CodeServerError, "删除失败")
		return
	}
	h.audit(c, id, "chat_endpoint_delete", "删除聊天接入地址")
	response.OK(c, gin.H{"ok": true})
}

func (h *chatProvidersHandler) audit(c *gin.Context, ref idgen.ID, action, summary string) {
	eventlog.Biz(&model.BizLog{
		OperatorID: middleware.CurrentUserID(c),
		Action:     action,
		Summary:    summary,
		RefID:      ref,
		RefType:    "chat_provider",
	})
}
