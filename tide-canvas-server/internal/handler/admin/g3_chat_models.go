package admin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/chatupstream"
	"tidecanvas/internal/pkg/response"
	"tidecanvas/internal/pkg/tokenbilling"
)

// g3_chat_models.go discovers what a provider offers and prices it. A model is
// only offered to AI chat once an operator has both enabled it and set what a
// million tokens cost — the gateway has no other way to charge for a call.

func toChatModelVO(m model.ChatModel) chatModelVO {
	vo := chatModelVO{
		ID: m.ID, ModelKey: m.ModelKey, Name: m.Name,
		Enabled: m.Enabled, SortOrder: m.SortOrder, Vision: m.Vision,
	}
	pricing, err := tokenbilling.Parse(m.Pricing)
	switch {
	case err == nil:
		vo.Pricing = pricing
	case strings.TrimSpace(m.Pricing) != "" && !errors.Is(err, tokenbilling.ErrNotConfigured):
		vo.PriceError = "单价配置无效"
	}
	return vo
}

// fetchModels asks the provider's addresses, in order, for their catalogue and
// records what comes back. Newly discovered models arrive disabled and unpriced:
// nothing can be sold before the operator has said what it costs.
func (h *chatProvidersHandler) fetchModels(c *gin.Context) {
	providerID, ok := g4ParseID(c)
	if !ok {
		return
	}
	var endpoints []model.ChatEndpoint
	if err := h.db.WithContext(c.Request.Context()).Where("provider_id = ? AND enabled = ?", providerID, true).
		Order("sort_order ASC, id ASC").Find(&endpoints).Error; err != nil || len(endpoints) == 0 {
		response.Fail(c, response.CodeBadRequest, "该供应商还没有可用的接入地址")
		return
	}

	// One overall budget rather than 30s per address: an operator with several
	// dead addresses would otherwise sit on a spinner for minutes.
	ctx, cancel := context.WithTimeout(c.Request.Context(), 45*time.Second)
	defer cancel()

	var keys []string
	lastErr := ""
	for _, endpoint := range endpoints {
		apiKey, err := h.vault.Open(endpoint.APIKey)
		if err != nil {
			lastErr = "该地址的 API Key 无法解密，请重新填写"
			continue
		}
		found, err := h.remoteModels(ctx, endpoint.BaseURL, apiKey)
		if err != nil {
			lastErr = err.Error()
			continue
		}
		keys = found
		break
	}
	if len(keys) == 0 {
		if lastErr == "" {
			lastErr = "供应商没有返回任何模型"
		}
		response.Fail(c, response.CodeBadRequest, "拉取模型失败："+lastErr)
		return
	}

	var existing []model.ChatModel
	if err := h.db.WithContext(c.Request.Context()).Where("provider_id = ?", providerID).Find(&existing).Error; err != nil {
		response.Fail(c, response.CodeServerError, "读取现有模型失败")
		return
	}
	known := map[string]bool{}
	for _, row := range existing {
		known[row.ModelKey] = true
	}
	// Discovery only adds. An operator's name, price and enabled state are their
	// decisions, and a re-fetch must not quietly undo them or drop a model the
	// upstream stopped advertising but users are still on.
	now := time.Now()
	added := 0
	for _, key := range keys {
		if known[key] {
			continue
		}
		row := model.ChatModel{ProviderID: providerID, ModelKey: key, Name: key, Enabled: false, DiscoveredAt: &now}
		if err := h.db.WithContext(c.Request.Context()).Create(&row).Error; err != nil {
			response.Fail(c, response.CodeServerError, "保存模型失败")
			return
		}
		added++
	}
	h.audit(c, providerID, "chat_models_fetch", fmt.Sprintf("拉取模型列表：上游 %d 个，新增 %d 个", len(keys), added))
	response.OK(c, gin.H{"total": len(keys), "added": added})
}

// remoteModels reads GET {base}/v1/models. The body is capped so a broken or
// hostile endpoint cannot exhaust memory here.
func (h *chatProvidersHandler) remoteModels(ctx context.Context, baseURL, apiKey string) ([]string, error) {
	req, err := http.NewRequestWithContext(ctx, "GET", chatupstream.Endpoint(baseURL, "models"), nil)
	if err != nil {
		return nil, errors.New("地址无效")
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Accept", "application/json")
	resp, err := h.client.Do(req)
	if err != nil {
		return nil, errors.New("连接失败")
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("上游返回 HTTP %d", resp.StatusCode)
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return nil, errors.New("读取响应失败")
	}
	var parsed struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if json.Unmarshal(raw, &parsed) != nil {
		return nil, errors.New("响应不是标准的模型列表")
	}
	out := make([]string, 0, len(parsed.Data))
	seen := map[string]bool{}
	for _, item := range parsed.Data {
		id := strings.TrimSpace(item.ID)
		if id == "" || len(id) > 128 || seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	return out, nil
}

type chatModelDTO struct {
	Name      *string          `json:"name" binding:"omitempty,max=128"`
	Enabled   *bool            `json:"enabled"`
	SortOrder *int             `json:"sortOrder"`
	Vision    *bool            `json:"vision"`
	Pricing   *json.RawMessage `json:"pricing"`
}

func (h *chatProvidersHandler) updateModel(c *gin.Context) {
	id, ok := g4ParseID(c)
	if !ok {
		return
	}
	var dto chatModelDTO
	if c.ShouldBindJSON(&dto) != nil {
		response.Fail(c, response.CodeBadRequest, "请求格式无效")
		return
	}
	var row model.ChatModel
	if err := h.db.WithContext(c.Request.Context()).First(&row, "id = ?", id).Error; err != nil {
		response.Fail(c, response.CodeNotFound, "模型不存在")
		return
	}

	fields := map[string]any{}
	pricing := row.Pricing
	if dto.Pricing != nil {
		pricing = strings.TrimSpace(string(*dto.Pricing))
		if pricing == "null" {
			pricing = ""
		}
		if pricing != "" {
			if _, err := tokenbilling.Parse(pricing); err != nil && !errors.Is(err, tokenbilling.ErrNotConfigured) {
				response.Fail(c, response.CodeBadRequest, "请填写有效的每百万输入/输出 Token 积分单价（最多六位小数）和 Token 上限")
				return
			}
		}
		fields["pricing"] = pricing
	}
	if dto.Enabled != nil {
		// Enabling an unpriced model would put an entry in the picker the
		// gateway then hides, so refuse here where the reason can be explained.
		if *dto.Enabled {
			if _, err := tokenbilling.Parse(pricing); err != nil {
				response.Fail(c, response.CodeBadRequest, "请先填写该模型的 Token 单价，再开放给 AI 聊天")
				return
			}
		}
		fields["enabled"] = *dto.Enabled
	}
	if dto.Name != nil {
		fields["name"] = strings.TrimSpace(*dto.Name)
	}
	if dto.SortOrder != nil {
		fields["sort_order"] = *dto.SortOrder
	}
	if dto.Vision != nil {
		fields["vision"] = *dto.Vision
	}
	if len(fields) == 0 {
		response.OK(c, gin.H{"ok": true})
		return
	}
	if err := h.db.WithContext(c.Request.Context()).Model(&model.ChatModel{}).Where("id = ?", id).Updates(fields).Error; err != nil {
		response.Fail(c, response.CodeServerError, "保存失败")
		return
	}
	h.audit(c, id, "chat_model_update", "修改聊天模型："+row.ModelKey)
	response.OK(c, gin.H{"ok": true})
}

func (h *chatProvidersHandler) deleteModel(c *gin.Context) {
	id, ok := g4ParseID(c)
	if !ok {
		return
	}
	if err := h.db.WithContext(c.Request.Context()).Where("id = ?", id).Delete(&model.ChatModel{}).Error; err != nil {
		response.Fail(c, response.CodeServerError, "删除失败")
		return
	}
	h.audit(c, id, "chat_model_delete", "删除聊天模型")
	response.OK(c, gin.H{"ok": true})
}
