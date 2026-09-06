package admin

import (
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
	"tidecanvas/internal/pkg/safefetch"
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

func RegisterChatProviders(g *gin.RouterGroup, d *app.Deps) {
	h := &chatProvidersHandler{
		db:    d.DB,
		vault: chatupstream.New(d.Cfg.JWT.Secret),
		// Model discovery follows an address an operator typed. NormalizeBaseURL
		// already refuses a literal internal address; this also refuses one a
		// hostname resolves to, which is the half a form check cannot see.
		client: safefetch.NewClient(30*time.Second, nil),
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
}

type chatProviderVO struct {
	ID        idgen.ID         `json:"id"`
	Name      string           `json:"name"`
	Enabled   bool             `json:"enabled"`
	SortOrder int              `json:"sortOrder"`
	Remark    string           `json:"remark"`
	Endpoints []chatEndpointVO `json:"endpoints"`
	Models    []chatModelVO    `json:"models"`
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
	if err := h.db.WithContext(ctx).Order("sort_order ASC, id ASC").Find(&models).Error; err != nil {
		response.Fail(c, response.CodeServerError, "读取模型失败")
		return
	}

	byProvider := map[idgen.ID]*chatProviderVO{}
	out := make([]*chatProviderVO, 0, len(providers))
	for _, p := range providers {
		vo := &chatProviderVO{
			ID: p.ID, Name: p.Name, Enabled: p.Enabled, SortOrder: p.SortOrder, Remark: p.Remark,
			Endpoints: []chatEndpointVO{}, Models: []chatModelVO{},
		}
		byProvider[p.ID] = vo
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
	for _, m := range models {
		vo, ok := byProvider[m.ProviderID]
		if !ok {
			continue
		}
		vo.Models = append(vo.Models, toChatModelVO(m))
	}
	response.OK(c, out)
}

// ---- providers ----

type chatProviderDTO struct {
	Name      *string `json:"name" binding:"omitempty,max=64"`
	Enabled   *bool   `json:"enabled"`
	SortOrder *int    `json:"sortOrder"`
	Remark    *string `json:"remark" binding:"omitempty,max=512"`
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
	if len(fields) == 0 {
		response.OK(c, gin.H{"ok": true})
		return
	}
	if err := h.db.WithContext(c.Request.Context()).Model(&model.ChatProvider{}).Where("id = ?", id).Updates(fields).Error; err != nil {
		response.Fail(c, response.CodeServerError, "保存失败")
		return
	}
	h.audit(c, id, "chat_provider_update", "修改聊天供应商")
	response.OK(c, gin.H{"ok": true})
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

const badBaseURL = "接入地址必须是 https 开头的地址，且不能带账号密码或查询参数"

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
		response.Fail(c, response.CodeBadRequest, badBaseURL)
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
			response.Fail(c, response.CodeBadRequest, badBaseURL)
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
