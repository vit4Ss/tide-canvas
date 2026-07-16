package admin

// relay_sync.go pulls the upstream model catalog from the ScarecrowToken relay
// (OpenAI-style GET /v1/models with a rich per-model params_schema) and upserts
// it into market_model. It backs the admin 模型管理「刷新」button
// (POST /admin/models/sync) and the cmd/importmodels tool, so both share one
// source of truth for the field mapping.
//
// On first import a model's Config (the GUI form settings: modes / ratios /
// resolutions / qualities / durations / price modifiers …) is pre-filled from the
// upstream schema. On a later re-sync the Config is left untouched if it is
// already set, so an admin's manual tweaks in the form are preserved; only the
// catalog-level fields (name key, type) are refreshed. Price is seeded on first
// import only — re-syncs never overwrite an existing row's price, so admin
// pricing edits survive.

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/shopspring/decimal"
	"gorm.io/gorm"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

// ErrRelayNotConfigured is returned when no relay API key is configured.
var ErrRelayNotConfigured = errors.New("relay not configured: missing api key")

// maxRelayRespBody caps the relay /v1/models response we read into memory (8MB).
const maxRelayRespBody = 8 << 20

// syncMu serializes catalog syncs within this process: model_key 非唯一索引(且可为空,
// 无法直接建唯一约束),两次并发「刷新」/与 importmodels 并跑会对同一 model_key 插入
// 重复行。串行化关掉了单实例内的竞态窗口(跨实例部署仍需运维层避免并发触发)。
var syncMu sync.Mutex

// RelayModel is one entry of the relay's GET /v1/models response.
type RelayModel struct {
	ID           string          `json:"id"`
	Name         string          `json:"name"`
	Modality     string          `json:"modality"` // image | video | text | audio
	CreditCost   float64         `json:"credit_cost"`
	Operations   []string        `json:"operations"`
	Capabilities []string        `json:"capabilities"`
	ResolutionOp []string        `json:"resolution_options"`
	ParamsSchema relayParams     `json:"params_schema"`
	PriceMods    json.RawMessage `json:"price_modifiers"`
}

type relayParams struct {
	Modes      []string        `json:"modes"`
	Aspect     []string        `json:"aspect"`
	Quality    []string        `json:"quality"`
	Resolution []string        `json:"resolution"`
	Duration   []string        `json:"duration"`
	EditImages json.RawMessage `json:"edit_images"`
	WebSearch  bool            `json:"web_search"`
	FileUpload bool            `json:"file_upload"`
}

// RelaySyncResult reports how many market_model rows were added vs. updated.
type RelaySyncResult struct {
	Created int `json:"created"`
	Updated int `json:"updated"`
	Failed  int `json:"failed"`
	Total   int `json:"total"`
}

// FetchRelayModels calls GET {baseURL}/v1/models with the key as a Bearer token.
// It tolerates a bare JSON array and an OpenAI-style {"data":[...]} envelope.
func FetchRelayModels(baseURL, key string) ([]RelayModel, error) {
	if strings.TrimSpace(key) == "" {
		return nil, ErrRelayNotConfigured
	}
	url := strings.TrimRight(strings.TrimSpace(baseURL), "/") + "/v1/models"
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(key))
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	// 限制响应体大小并检查读错误(与 relaymedia 的谨慎做法一致),避免异常大响应打爆内存。
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxRelayRespBody))
	if err != nil {
		return nil, fmt.Errorf("read relay response: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("relay HTTP %d: %s", resp.StatusCode, truncate(string(body), 200))
	}

	var arr []RelayModel
	if err := json.Unmarshal(body, &arr); err == nil && len(arr) > 0 {
		return arr, nil
	}
	var wrapped struct {
		Data []RelayModel `json:"data"`
	}
	if err := json.Unmarshal(body, &wrapped); err != nil {
		return nil, fmt.Errorf("parse relay models: %w", err)
	}
	return wrapped.Data, nil
}

// SyncRelayModels fetches the relay catalog and upserts it into market_model.
func SyncRelayModels(db *gorm.DB, baseURL, key string, newStatus int, authorID idgen.ID) (RelaySyncResult, error) {
	syncMu.Lock()
	defer syncMu.Unlock()

	models, err := FetchRelayModels(baseURL, key)
	if err != nil {
		return RelaySyncResult{}, err
	}

	res := RelaySyncResult{Total: len(models)}
	for _, m := range models {
		modelKey := strings.TrimSpace(m.ID)
		name := strings.TrimSpace(m.Name)
		if name == "" {
			name = modelKey
		}
		if name == "" && modelKey == "" {
			continue
		}
		typ := relayModality(m.Modality)
		price := decimal.NewFromFloat(m.CreditCost)
		cfg := buildStudioConfig(m)

		// Match an existing row by the STABLE model_key (the relay id), not the
		// display name — so renaming a model in the admin form (or a relay-side
		// name change) doesn't make the next sync insert a duplicate. Fall back to
		// name only when the relay omits an id.
		var existing model.MarketModel
		var lookErr error
		if modelKey != "" {
			lookErr = db.Where("model_key = ?", modelKey).First(&existing).Error
		} else {
			lookErr = db.Where("name = ?", name).First(&existing).Error
		}

		// A single model's failure must not abort the whole catalog sync; count it
		// and continue so the operator gets accurate created/updated/failed totals.
		if lookErr == nil {
			// Price is intentionally NOT refreshed here: admins may have re-priced
			// the model locally, and a sync must not clobber that.
			fields := map[string]any{
				"type":      typ,
				"model_key": modelKey,
			}
			// Preserve admin-edited config; only seed it when still empty.
			if strings.TrimSpace(existing.Config) == "" {
				fields["config"] = cfg
			}
			if upErr := db.Model(&model.MarketModel{}).Where("id = ?", existing.ID).Updates(fields).Error; upErr != nil {
				res.Failed++
				continue
			}
			res.Updated++
			continue
		}
		if !errors.Is(lookErr, gorm.ErrRecordNotFound) {
			res.Failed++
			continue
		}

		row := model.MarketModel{
			AuthorID: authorID,
			Name:     name,
			ModelKey: modelKey,
			Type:     typ,
			Config:   cfg,
			Price:    price,
			Status:   newStatus,
		}
		row.ID = idgen.Next()
		row.CreateTime = time.Now()
		row.UpdateTime = time.Now()
		if crErr := db.Create(&row).Error; crErr != nil {
			res.Failed++
			continue
		}
		res.Created++
	}
	return res, nil
}

// buildStudioConfig maps a relay model's params_schema into the GUI form's config
// shape (the same JSON the admin 配置 form reads/writes). Fields the relay does
// not provide (provider / icon / costUsd / estSeconds / batch sizes / grid output
// / price matrix) get sensible defaults for the admin to refine.
func buildStudioConfig(m RelayModel) string {
	resolutions := m.ParamsSchema.Resolution
	if len(resolutions) == 0 {
		resolutions = m.ResolutionOp
	}

	// edit_images.max → 图生图 max reference image count.
	maxRefImages := 0
	if len(m.ParamsSchema.EditImages) > 0 {
		var ei struct {
			Max int `json:"max"`
		}
		if json.Unmarshal(m.ParamsSchema.EditImages, &ei) == nil {
			maxRefImages = ei.Max
		}
	}

	cfg := map[string]any{
		"provider":          "",
		"icon":              "",
		"costUsd":           "",
		"estSeconds":        0,
		"modes":             orEmpty(m.ParamsSchema.Modes),
		"ratios":            orEmpty(m.ParamsSchema.Aspect),
		"resolutions":       orEmpty(resolutions),
		"qualities":         orEmpty(m.ParamsSchema.Quality),
		"durations":         orEmpty(m.ParamsSchema.Duration),
		"batchOptions":      []int{1, 2, 3, 4},
		"gridOutput":        false,
		"maxRefImages":      maxRefImages,
		"maxRefImageSizeMB": 0,
		"webSearch":         m.ParamsSchema.WebSearch,
		"fileUpload":        m.ParamsSchema.FileUpload,
		"maxFileSizeMB":     0,
		"capabilities":      orEmpty(m.Capabilities),
		"operations":        orEmpty(m.Operations),
		"priceMatrix":       map[string]any{},
		"priceModifiers":    rawObjOrEmpty(m.PriceMods),
		"creditCost":        m.CreditCost,
	}
	b, err := json.Marshal(cfg)
	if err != nil {
		return ""
	}
	return string(b)
}

func orEmpty(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

func rawObjOrEmpty(raw json.RawMessage) any {
	if len(raw) == 0 || !json.Valid(raw) {
		return map[string]any{}
	}
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		return map[string]any{}
	}
	return v
}

// relayModality maps the relay modality to a market_model.Type bucket.
func relayModality(m string) string {
	switch strings.ToLower(strings.TrimSpace(m)) {
	case "image", "video", "audio", "text":
		return strings.ToLower(strings.TrimSpace(m))
	default:
		return "image"
	}
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "…"
}
