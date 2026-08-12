package admin

// g3_models.go (group g3) owns the admin 模型市场 management surface. It is the
// LINKED admin section for the public 模型市场 (/api/market): every read/write here
// operates on the SAME market_model table the public /models page consumes, so an
// admin edit is immediately visible on the front-end. There is no parallel
// admin-only copy.
//
// As a secondary, read-only convenience it also exposes the underlying generation
// registry (ai_model + ai_provider) so the admin can see which inference models /
// providers are available when wiring a market model's AiModelID. Those two are
// management of the registry tables, not duplicated copies.

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"

	"tidecanvas/internal/app"
	"tidecanvas/internal/config"
	"tidecanvas/internal/middleware"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
)

// RegisterModels mounts the admin model-market routes on the (already
// JWTAuth+AdminOnly gated) /admin group.
//
// Routes:
//
//	GET    /admin/models             AdminModelQuery -> PageData<AdminModelVO>  (from market_model)
//	POST   /admin/models             AdminModelCreateDTO -> AdminModelVO
//	PUT    /admin/models/order       AdminModelOrderDTO -> void        (类型内模型排序)
//	GET    /admin/models/type-order  -> {types}                        (选择器类型顺序)
//	PUT    /admin/models/type-order  AdminModelTypeOrderDTO -> {types}
//	PUT    /admin/models/:id         AdminModelUpdateDTO -> AdminModelVO
//	PUT    /admin/models/:id/status  AdminModelStatusDTO -> AdminModelVO
//	DELETE /admin/models/:id         -> void
//	GET    /admin/ai-models          -> List<AdminAiModelVO>     (generation registry, read-only)
//	GET    /admin/ai-providers       -> List<AdminAiProviderVO>  (generation registry, read-only)
//
// The :id param only ever appears under the static /models parent; static
// siblings (/order, /type-order, /sync) are declared first — gin matches
// static segments before :param, so they do not conflict.
func RegisterModels(g *gin.RouterGroup, d *app.Deps) {
	h := &modelsHandler{db: d.DB, relay: d.Cfg.Relay}

	g.GET("/models", h.list)
	g.POST("/models", h.create)
	g.POST("/models/sync", h.syncRelay)
	g.PUT("/models/order", h.reorder)
	g.GET("/models/type-order", h.getTypeOrder)
	g.PUT("/models/type-order", h.putTypeOrder)
	// 模型状态页（?scope=enabled|all）：探测样本聚合，见 g3_model_status.go。
	g.GET("/models/status", h.modelStatus)
	g.PUT("/models/:id", h.update)
	g.PUT("/models/:id/status", h.setStatus)
	g.DELETE("/models/:id", h.remove)

	// Generation registry (read-only): the underlying ai_model / ai_provider rows
	// a market model can be linked to via aiModelId.
	g.GET("/ai-models", h.listAiModels)
	g.GET("/ai-providers", h.listAiProviders)
}

type modelsHandler struct {
	db    *gorm.DB
	relay config.RelayConfig
}

// ---- VOs ----

// AdminModelVO is the admin list/detail view of a market_model row. It exposes
// the raw editable columns (so the admin form round-trips cleanly) and the usage
// metrics. `enabled` is derived from Status (1 已上架 => true). `pointCost` mirrors
// the model price (points cost to run / acquire). This is the same row the public
// 模型市场 renders, just in its administrative shape.
type AdminModelVO struct {
	ID          idgen.ID        `json:"id"`
	Name        string          `json:"name"`
	Description string          `json:"description"`
	CoverUrl    string          `json:"coverUrl"`
	Tags        string          `json:"tags"`
	Type        string          `json:"type"`     // media category: text | image | video | audio | 3d
	ModelKey    string          `json:"modelKey"` // upstream model id
	Config      json.RawMessage `json:"config"`   // per-model generation settings (object or null)
	CategoryId  *idgen.ID       `json:"categoryId"`
	AiModelId   *idgen.ID       `json:"aiModelId"`
	AuthorId    idgen.ID        `json:"authorId"`
	AuthorName  string          `json:"authorName"`
	Price       string          `json:"price"`     // decimal as string
	PointCost   string          `json:"pointCost"` // alias of price (points to run)
	Status      int             `json:"status"`    // 0 待审核 / 1 已上架 / 2 已下架
	Enabled     bool            `json:"enabled"`   // Status == 1
	SortOrder   int             `json:"sortOrder"` // 类型内顺序（小值在前）
	UseCount    int             `json:"useCount"`
	Usage       int             `json:"usage"` // alias of useCount
	LikeCount   int             `json:"likeCount"`
	CreateTime  string          `json:"createTime"`
	UpdateTime  string          `json:"updateTime"`
}

// AdminAiModelVO is the read-only generation-registry view of an ai_model.
type AdminAiModelVO struct {
	ID                idgen.ID `json:"id"`
	Name              string   `json:"name"`
	Icon              string   `json:"icon"`
	ModelId           string   `json:"modelId"`
	Type              string   `json:"type"`
	SupportedHandlers string   `json:"supportedHandlers"`
	PointCost         int64    `json:"pointCost"`
	Enabled           bool     `json:"enabled"`
	SortOrder         int      `json:"sortOrder"`
}

// AdminAiProviderVO is the read-only generation-registry view of an ai_provider.
// Secrets (api keys) are never serialized.
type AdminAiProviderVO struct {
	ID           idgen.ID `json:"id"`
	Name         string   `json:"name"`
	ProviderType string   `json:"providerType"`
	BaseUrl      string   `json:"baseUrl"`
	Status       int      `json:"status"`
	Priority     int      `json:"priority"`
	RateLimit    int      `json:"rateLimit"`
}

// ---- DTOs ----

// AdminModelQuery is the paged list filter.
type AdminModelQuery struct {
	PageNum    int    `form:"pageNum"`
	PageSize   int    `form:"pageSize"`
	Keyword    string `form:"keyword"`    // matches name/description/tags
	Status     *int   `form:"status"`     // 0/1/2 exact match
	CategoryId string `form:"categoryId"` // filter by category
	Type       string `form:"type"`       // media category: text|image|video|audio|3d
}

func (q *AdminModelQuery) normalize() {
	if q.PageNum <= 0 {
		q.PageNum = 1
	}
	if q.PageSize <= 0 {
		q.PageSize = 20
	}
	if q.PageSize > 100 {
		q.PageSize = 100
	}
	q.Keyword = strings.TrimSpace(q.Keyword)
	q.CategoryId = strings.TrimSpace(q.CategoryId)
	q.Type = strings.TrimSpace(q.Type)
}

func (q *AdminModelQuery) offset() int { return (q.PageNum - 1) * q.PageSize }

// AdminModelCreateDTO creates a market_model row (immediately live on /models).
type AdminModelCreateDTO struct {
	Name        string          `json:"name" binding:"required,max=128"`
	Description string          `json:"description" binding:"omitempty,max=8192"`
	CoverUrl    string          `json:"coverUrl" binding:"omitempty,max=512"`
	Tags        string          `json:"tags" binding:"omitempty,max=512"`
	Type        string          `json:"type" binding:"omitempty,oneof=text image video audio 3d upscale"`
	ModelKey    string          `json:"modelKey" binding:"omitempty,max=128"`
	Config      json.RawMessage `json:"config" binding:"omitempty"`
	CategoryId  string          `json:"categoryId" binding:"omitempty"`
	AiModelId   string          `json:"aiModelId" binding:"omitempty"`
	AuthorId    string          `json:"authorId" binding:"omitempty"`
	Price       *string         `json:"price" binding:"omitempty"`
	PointCost   *string         `json:"pointCost" binding:"omitempty"` // alias for price
	Status      *int            `json:"status" binding:"omitempty"`
}

// AdminModelUpdateDTO is a partial update; nil fields are left unchanged.
type AdminModelUpdateDTO struct {
	Name        *string         `json:"name" binding:"omitempty,max=128"`
	Description *string         `json:"description" binding:"omitempty,max=8192"`
	CoverUrl    *string         `json:"coverUrl" binding:"omitempty,max=512"`
	Tags        *string         `json:"tags" binding:"omitempty,max=512"`
	Type        *string         `json:"type" binding:"omitempty,oneof=text image video audio 3d upscale"`
	ModelKey    *string         `json:"modelKey" binding:"omitempty,max=128"`
	Config      json.RawMessage `json:"config" binding:"omitempty"`
	CategoryId  *string         `json:"categoryId" binding:"omitempty"`
	AiModelId   *string         `json:"aiModelId" binding:"omitempty"`
	Price       *string         `json:"price" binding:"omitempty"`
	PointCost   *string         `json:"pointCost" binding:"omitempty"`
	Status      *int            `json:"status" binding:"omitempty"`
}

// AdminModelStatusDTO toggles publish state. Either status (0/1/2) or enabled may
// be sent; enabled maps to status 1 (on) / 2 (off, 已下架).
type AdminModelStatusDTO struct {
	Status  *int  `json:"status" binding:"omitempty"`
	Enabled *bool `json:"enabled" binding:"omitempty"`
}

// AdminModelOrderDTO reorders models inside a type: ids in display order;
// each row gets sort_order = start + index（start 承接分页偏移，避免第 2 页
// 的重排把第 1 页的序号顶掉）.
type AdminModelOrderDTO struct {
	Ids   []string `json:"ids" binding:"required,min=1,max=500"`
	Start int      `json:"start" binding:"omitempty,gte=0"`
}

// AdminModelTypeOrderDTO carries the picker order of media types.
type AdminModelTypeOrderDTO struct {
	Types []string `json:"types" binding:"required,min=1,max=8"`
}

// ---- Handlers ----

func (h *modelsHandler) list(c *gin.Context) {
	var q AdminModelQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid query: "+err.Error())
		return
	}
	q.normalize()

	tx := h.db.Model(&model.MarketModel{})
	if q.Keyword != "" {
		like := "%" + q.Keyword + "%"
		tx = tx.Where("name LIKE ? OR description LIKE ? OR tags LIKE ?", like, like, like)
	}
	if q.Status != nil {
		tx = tx.Where("status = ?", *q.Status)
	}
	if q.CategoryId != "" {
		if cid, err := idgen.Parse(q.CategoryId); err == nil && cid != 0 {
			tx = tx.Where("category_id = ?", cid)
		}
	}
	if q.Type != "" {
		tx = tx.Where("type = ?", q.Type)
	}

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to count models")
		return
	}

	// 按类型筛选时按手工排序展示（供行内上移/下移所见即所得）；全部视图按
	// 最近更新（跨类型的 sort_order 相互独立，混排无意义）。
	order := "update_time DESC"
	if q.Type != "" {
		order = "sort_order ASC, id ASC"
	}
	var rows []model.MarketModel
	if err := tx.Order(order).
		Limit(q.PageSize).Offset(q.offset()).Find(&rows).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to list models")
		return
	}

	authors := h.authorNames(rows)
	vos := make([]AdminModelVO, 0, len(rows))
	for i := range rows {
		vos = append(vos, toAdminModelVO(&rows[i], authors[rows[i].AuthorID]))
	}
	response.Page(c, vos, total, q.PageNum, q.PageSize)
}

func (h *modelsHandler) create(c *gin.Context) {
	var dto AdminModelCreateDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}

	if configMarksPrimary(dto.Config) {
		if name, ok := h.otherPrimaryName(0); ok {
			response.Fail(c, response.CodeBadRequest, "已有 AI 优化主模型「"+name+"」，请先解除后再选择")
			return
		}
	}

	mType := strings.TrimSpace(dto.Type)
	if mType == "" {
		mType = "image"
	}
	if mType == "upscale" {
		if err := validateUpscalePricingConfig(dto.Config); err != nil {
			response.Fail(c, response.CodeBadRequest, err.Error())
			return
		}
	}
	if mType == "video" {
		if err := validateReferenceVideoPricingConfig(dto.Config); err != nil {
			response.Fail(c, response.CodeBadRequest, err.Error())
			return
		}
	}
	m := &model.MarketModel{
		Name:        strings.TrimSpace(dto.Name),
		Description: strings.TrimSpace(dto.Description),
		CoverURL:    strings.TrimSpace(dto.CoverUrl),
		Tags:        strings.TrimSpace(dto.Tags),
		Type:        mType,
		ModelKey:    strings.TrimSpace(dto.ModelKey),
		Config:      rawToString(dto.Config),
		Status:      1, // default 已上架 so it shows on /models immediately
	}
	if cid := parseOptID(dto.CategoryId); cid != nil {
		m.CategoryID = cid
	}
	if aid := parseOptID(dto.AiModelId); aid != nil {
		m.AiModelID = aid
	}
	if author := parseOptID(dto.AuthorId); author != nil {
		m.AuthorID = *author
	} else {
		m.AuthorID = middleware.CurrentUserID(c)
	}
	if p := firstNonNil(dto.Price, dto.PointCost); p != nil {
		if dec, err := decimal.NewFromString(strings.TrimSpace(*p)); err == nil {
			m.Price = dec
		}
	}
	if dto.Status != nil {
		m.Status = *dto.Status
	}

	// status is force-written: a struct Create would swallow status:0 (下架)
	// via the default:1 tag and list the model on /models immediately.
	if err := adminCreateRow(h.db, m, map[string]any{"status": m.Status}); err != nil {
		response.Fail(c, response.CodeServerError, "failed to create model")
		return
	}
	h.respondOne(c, m)
}

// reorder assigns sort_order = start + index for the given ids（类型内排序；
// 与 floors reorder 同款，事务内整批更新，不存在半排状态）.
func (h *modelsHandler) reorder(c *gin.Context) {
	var dto AdminModelOrderDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}
	ids := make([]idgen.ID, 0, len(dto.Ids))
	for _, s := range dto.Ids {
		id, err := idgen.Parse(strings.TrimSpace(s))
		if err != nil || id == 0 {
			response.Fail(c, response.CodeBadRequest, "invalid id: "+s)
			return
		}
		ids = append(ids, id)
	}
	err := h.db.Transaction(func(tx *gorm.DB) error {
		for i, id := range ids {
			if e := tx.Model(&model.MarketModel{}).Where("id = ?", id).
				UpdateColumn("sort_order", dto.Start+i).Error; e != nil {
				return e
			}
		}
		return nil
	})
	if err != nil {
		response.Fail(c, response.CodeServerError, "failed to reorder models")
		return
	}
	response.OK[any](c, nil)
}

// getTypeOrder returns the effective picker order of media types.
func (h *modelsHandler) getTypeOrder(c *gin.Context) {
	response.OK(c, gin.H{"types": h.effectiveTypeOrder()})
}

// putTypeOrder validates and persists the picker order to sys_config
// (market.typeOrder). Unknown/duplicate entries are rejected; missing types
// are appended by ParseMarketTypeOrder so the pickers never lose a category.
func (h *modelsHandler) putTypeOrder(c *gin.Context) {
	var dto AdminModelTypeOrderDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}
	valid := map[string]bool{}
	for _, t := range model.MarketModelTypes {
		valid[t] = true
	}
	seen := map[string]bool{}
	for _, t := range dto.Types {
		t = strings.TrimSpace(t)
		if !valid[t] {
			response.Fail(c, response.CodeBadRequest, "未知模型类型: "+t)
			return
		}
		if seen[t] {
			response.Fail(c, response.CodeBadRequest, "重复模型类型: "+t)
			return
		}
		seen[t] = true
	}
	order := model.ParseMarketTypeOrder(strings.Join(dto.Types, ","))
	value := strings.Join(order, ",")

	var row model.SysConfig
	err := h.db.Where("config_key = ?", model.ConfigKeyMarketTypeOrder).First(&row).Error
	switch {
	case err == nil:
		if e := h.db.Model(&model.SysConfig{}).Where("id = ?", row.ID).
			UpdateColumn("config_value", value).Error; e != nil {
			response.Fail(c, response.CodeServerError, "failed to save type order")
			return
		}
	case errors.Is(err, gorm.ErrRecordNotFound):
		row = model.SysConfig{
			ConfigKey:   model.ConfigKeyMarketTypeOrder,
			ConfigValue: value,
			Group:       "market",
			Description: "模型选择器的类型顺序（逗号分隔），后台「模型管理 · 类型排序」编辑",
		}
		if e := h.db.Create(&row).Error; e != nil {
			response.Fail(c, response.CodeServerError, "failed to save type order")
			return
		}
	default:
		response.Fail(c, response.CodeServerError, "failed to save type order")
		return
	}
	response.OK(c, gin.H{"types": order})
}

// effectiveTypeOrder reads the stored order, falling back to the default.
func (h *modelsHandler) effectiveTypeOrder() []string {
	var row model.SysConfig
	if err := h.db.Select("config_value").
		Where("config_key = ?", model.ConfigKeyMarketTypeOrder).
		First(&row).Error; err == nil {
		if parsed := model.ParseMarketTypeOrder(row.ConfigValue); parsed != nil {
			return parsed
		}
	}
	return model.DefaultMarketTypeOrder
}

// syncRelay pulls the upstream relay model catalog and upserts it into
// market_model (add new / update existing by stable model_key), returning
// add/update counts.
// New rows are listed (status 1) and authored by the current admin.
func (h *modelsHandler) syncRelay(c *gin.Context) {
	// 未配置 ≠ 服务器故障：这是写给管理员的操作指引，用 500 会被统一话术抹成
	// 「请联系客服」，而管理员自己就是客服，等于把唯一可操作的信息弄丢了。
	if strings.TrimSpace(h.relay.APIKey) == "" {
		response.Fail(c, response.CodeBadRequest, "中转站未配置：请在 config.yaml 设置 relay.apiKey")
		return
	}
	res, err := SyncRelayModels(h.db, h.relay.BaseURL, h.relay.APIKey, 1, middleware.CurrentUserID(c))
	if err != nil {
		response.Fail(c, response.CodeServerError, "同步失败："+err.Error())
		return
	}
	response.OK(c, res)
}

func (h *modelsHandler) update(c *gin.Context) {
	id, ok := parsePathID(c)
	if !ok {
		return
	}
	var dto AdminModelUpdateDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}

	if dto.Config != nil && configMarksPrimary(dto.Config) {
		if name, ok := h.otherPrimaryName(id); ok {
			response.Fail(c, response.CodeBadRequest, "已有 AI 优化主模型「"+name+"」，请先解除后再选择")
			return
		}
	}
	// The UI sends type+config together, but the API also protects partial/manual
	// updates so an upscaler can never be saved with an unpriced output tier.
	if dto.Config != nil || dto.Type != nil || (dto.Status != nil && *dto.Status == 1) {
		var current model.MarketModel
		if err := h.db.Select("type", "config").First(&current, "id = ?", id).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				response.Fail(c, response.CodeNotFound, "model not found")
			} else {
				response.Fail(c, response.CodeServerError, "failed to load model")
			}
			return
		}
		effectiveType := current.Type
		if dto.Type != nil {
			effectiveType = strings.TrimSpace(*dto.Type)
		}
		effectiveConfig := json.RawMessage(current.Config)
		if dto.Config != nil {
			effectiveConfig = dto.Config
		}
		if effectiveType == "upscale" {
			if err := validateUpscalePricingConfig(effectiveConfig); err != nil {
				response.Fail(c, response.CodeBadRequest, err.Error())
				return
			}
		}
		if effectiveType == "video" {
			if err := validateReferenceVideoPricingConfig(effectiveConfig); err != nil {
				response.Fail(c, response.CodeBadRequest, err.Error())
				return
			}
		}
	}

	fields := map[string]any{}
	if dto.Name != nil {
		fields["name"] = strings.TrimSpace(*dto.Name)
	}
	if dto.Description != nil {
		fields["description"] = strings.TrimSpace(*dto.Description)
	}
	if dto.CoverUrl != nil {
		fields["cover_url"] = strings.TrimSpace(*dto.CoverUrl)
	}
	if dto.Tags != nil {
		fields["tags"] = strings.TrimSpace(*dto.Tags)
	}
	if dto.Type != nil {
		fields["type"] = strings.TrimSpace(*dto.Type)
	}
	if dto.ModelKey != nil {
		fields["model_key"] = strings.TrimSpace(*dto.ModelKey)
	}
	if dto.Config != nil {
		fields["config"] = rawToString(dto.Config)
	}
	if dto.CategoryId != nil {
		fields["category_id"] = parseOptID(*dto.CategoryId)
	}
	if dto.AiModelId != nil {
		fields["ai_model_id"] = parseOptID(*dto.AiModelId)
	}
	if p := firstNonNil(dto.Price, dto.PointCost); p != nil {
		if dec, err := decimal.NewFromString(strings.TrimSpace(*p)); err == nil {
			fields["price"] = dec
		}
	}
	if dto.Status != nil {
		fields["status"] = *dto.Status
	}

	if len(fields) > 0 {
		res := h.db.Model(&model.MarketModel{}).Where("id = ?", id).Updates(fields)
		if res.Error != nil {
			response.Fail(c, response.CodeServerError, "failed to update model")
			return
		}
		if res.RowsAffected == 0 {
			response.Fail(c, response.CodeNotFound, "model not found")
			return
		}
	}
	h.respondByID(c, id)
}

func (h *modelsHandler) setStatus(c *gin.Context) {
	id, ok := parsePathID(c)
	if !ok {
		return
	}
	var dto AdminModelStatusDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}

	status := -1
	if dto.Status != nil {
		status = *dto.Status
	} else if dto.Enabled != nil {
		if *dto.Enabled {
			status = 1 // 已上架
		} else {
			status = 2 // 已下架
		}
	}
	if status < 0 {
		response.Fail(c, response.CodeBadRequest, "status or enabled required")
		return
	}
	if status == 1 {
		var current model.MarketModel
		if err := h.db.Select("type", "config").First(&current, "id = ?", id).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				response.Fail(c, response.CodeNotFound, "model not found")
			} else {
				response.Fail(c, response.CodeServerError, "failed to load model")
			}
			return
		}
		if current.Type == "upscale" {
			if err := validateUpscalePricingConfig(json.RawMessage(current.Config)); err != nil {
				response.Fail(c, response.CodeBadRequest, err.Error())
				return
			}
		}
		if current.Type == "video" {
			if err := validateReferenceVideoPricingConfig(json.RawMessage(current.Config)); err != nil {
				response.Fail(c, response.CodeBadRequest, err.Error())
				return
			}
		}
	}

	res := h.db.Model(&model.MarketModel{}).Where("id = ?", id).Update("status", status)
	if res.Error != nil {
		response.Fail(c, response.CodeServerError, "failed to update status")
		return
	}
	if res.RowsAffected == 0 {
		response.Fail(c, response.CodeNotFound, "model not found")
		return
	}
	h.respondByID(c, id)
}

func (h *modelsHandler) remove(c *gin.Context) {
	id, ok := parsePathID(c)
	if !ok {
		return
	}
	res := h.db.Where("id = ?", id).Delete(&model.MarketModel{})
	if res.Error != nil {
		response.Fail(c, response.CodeServerError, "failed to delete model")
		return
	}
	if res.RowsAffected == 0 {
		response.Fail(c, response.CodeNotFound, "model not found")
		return
	}
	response.OK[any](c, nil)
}

func (h *modelsHandler) listAiModels(c *gin.Context) {
	var rows []model.AiModel
	if err := h.db.Order("sort_order ASC, create_time DESC").Find(&rows).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to list ai models")
		return
	}
	vos := make([]AdminAiModelVO, 0, len(rows))
	for i := range rows {
		r := &rows[i]
		vos = append(vos, AdminAiModelVO{
			ID:                r.ID,
			Name:              r.Name,
			Icon:              r.Icon,
			ModelId:           r.ModelID,
			Type:              r.Type,
			SupportedHandlers: r.SupportedHandlers,
			PointCost:         r.PointCost,
			Enabled:           r.Enabled,
			SortOrder:         r.SortOrder,
		})
	}
	response.OK(c, vos)
}

func (h *modelsHandler) listAiProviders(c *gin.Context) {
	var rows []model.AiProvider
	if err := h.db.Order("priority DESC, create_time DESC").Find(&rows).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to list ai providers")
		return
	}
	vos := make([]AdminAiProviderVO, 0, len(rows))
	for i := range rows {
		r := &rows[i]
		vos = append(vos, AdminAiProviderVO{
			ID:           r.ID,
			Name:         r.Name,
			ProviderType: r.ProviderType,
			BaseUrl:      r.BaseUrl,
			Status:       r.Status,
			Priority:     r.Priority,
			RateLimit:    r.RateLimit,
		})
	}
	response.OK(c, vos)
}

// ---- helpers ----

// respondByID reloads the row and writes its VO. Returns 404 when gone.
func (h *modelsHandler) respondByID(c *gin.Context, id idgen.ID) {
	var m model.MarketModel
	if err := h.db.Where("id = ?", id).First(&m).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			response.Fail(c, response.CodeNotFound, "model not found")
			return
		}
		response.Fail(c, response.CodeServerError, "failed to load model")
		return
	}
	h.respondOne(c, &m)
}

// respondOne resolves the author name and writes the model VO.
func (h *modelsHandler) respondOne(c *gin.Context, m *model.MarketModel) {
	var name string
	if m.AuthorID != 0 {
		var u model.User
		if err := h.db.Select("id", "username", "nickname").Where("id = ?", m.AuthorID).First(&u).Error; err == nil {
			name = pickName(&u)
		}
	}
	response.OK(c, toAdminModelVO(m, name))
}

// authorNames batch-resolves author display names for a page of rows.
func (h *modelsHandler) authorNames(rows []model.MarketModel) map[idgen.ID]string {
	out := map[idgen.ID]string{}
	ids := make([]idgen.ID, 0, len(rows))
	seen := map[idgen.ID]struct{}{}
	for i := range rows {
		aid := rows[i].AuthorID
		if aid == 0 {
			continue
		}
		if _, ok := seen[aid]; ok {
			continue
		}
		seen[aid] = struct{}{}
		ids = append(ids, aid)
	}
	if len(ids) == 0 {
		return out
	}
	var users []model.User
	if err := h.db.Select("id", "username", "nickname").Where("id IN ?", ids).Find(&users).Error; err == nil {
		for i := range users {
			out[users[i].ID] = pickName(&users[i])
		}
	}
	return out
}

func toAdminModelVO(m *model.MarketModel, authorName string) AdminModelVO {
	price := m.Price.String()
	enabled := m.Status == 1
	return AdminModelVO{
		ID:          m.ID,
		Name:        m.Name,
		Description: m.Description,
		CoverUrl:    m.CoverURL,
		Tags:        m.Tags,
		Type:        m.Type,
		ModelKey:    m.ModelKey,
		Config:      stringToRaw(m.Config),
		CategoryId:  m.CategoryID,
		AiModelId:   m.AiModelID,
		AuthorId:    m.AuthorID,
		AuthorName:  authorName,
		Price:       price,
		PointCost:   price,
		Status:      m.Status,
		Enabled:     enabled,
		SortOrder:   m.SortOrder,
		UseCount:    m.UseCount,
		Usage:       m.UseCount,
		LikeCount:   m.LikeCount,
		CreateTime:  g3FmtTime(m.CreateTime),
		UpdateTime:  g3FmtTime(m.UpdateTime),
	}
}

// configMarksPrimary reports whether an inbound config object sets the
// aiOptimizePrimary flag (the global "AI 优化主模型").
func configMarksPrimary(raw json.RawMessage) bool {
	if len(raw) == 0 {
		return false
	}
	var c struct {
		AiOptimizePrimary bool `json:"aiOptimizePrimary"`
	}
	_ = json.Unmarshal(raw, &c)
	return c.AiOptimizePrimary
}

// otherPrimaryName returns the name of any OTHER model already flagged as the
// AI-optimization primary (excluding excludeID). Used to enforce a single primary.
func (h *modelsHandler) otherPrimaryName(excludeID idgen.ID) (string, bool) {
	var rows []model.MarketModel
	if err := h.db.Where("config LIKE ?", `%"aiOptimizePrimary":true%`).Find(&rows).Error; err != nil {
		return "", false
	}
	for i := range rows {
		if rows[i].ID != excludeID {
			return rows[i].Name, true
		}
	}
	return "", false
}

// rawToString stores an inbound JSON config object as text ("" when empty/invalid
// so the column never holds garbage).
func rawToString(raw json.RawMessage) string {
	if len(raw) == 0 || !json.Valid(raw) {
		return ""
	}
	return string(raw)
}

var defaultUpscalePricingResolutions = []string{"720p", "1080p", "2k", "4k"}

func validateUpscalePricingConfig(raw json.RawMessage) error {
	if len(raw) == 0 || !json.Valid(raw) {
		return errors.New("超分模型必须配置各目标分辨率的每秒积分")
	}
	var cfg struct {
		Resolutions                []string                   `json:"resolutions"`
		PricePerSecondByResolution map[string]json.RawMessage `json:"pricePerSecondByResolution"`
	}
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return errors.New("超分模型定价配置无效")
	}
	resolutions := cfg.Resolutions
	if len(resolutions) == 0 {
		resolutions = defaultUpscalePricingResolutions
	}
	for _, resolution := range resolutions {
		resolution = strings.ToLower(strings.TrimSpace(resolution))
		if resolution == "" {
			continue
		}
		rate := 0.0
		for key, encoded := range cfg.PricePerSecondByResolution {
			if !strings.EqualFold(strings.TrimSpace(key), resolution) {
				continue
			}
			if err := json.Unmarshal(encoded, &rate); err != nil {
				var text string
				if json.Unmarshal(encoded, &text) == nil {
					rate, _ = strconv.ParseFloat(strings.TrimSpace(text), 64)
				}
			}
			break
		}
		if rate <= 0 || math.IsNaN(rate) || math.IsInf(rate, 0) {
			return fmt.Errorf("请配置 %s 的每秒积分", strings.ToUpper(resolution))
		}
	}
	return nil
}

func validateReferenceVideoPricingConfig(raw json.RawMessage) error {
	if len(raw) == 0 {
		return nil
	}
	if !json.Valid(raw) {
		return errors.New("参考视频计费配置无效")
	}
	var cfg struct {
		Enabled bool            `json:"referenceVideoBillingEnabled"`
		Rate    json.RawMessage `json:"referenceVideoPricePerSecond"`
	}
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return errors.New("参考视频计费配置无效")
	}
	if !cfg.Enabled {
		return nil
	}
	rate := 0.0
	if len(cfg.Rate) > 0 {
		if err := json.Unmarshal(cfg.Rate, &rate); err != nil {
			var text string
			if json.Unmarshal(cfg.Rate, &text) == nil {
				rate, _ = strconv.ParseFloat(strings.TrimSpace(text), 64)
			}
		}
	}
	if rate <= 0 || math.IsNaN(rate) || math.IsInf(rate, 0) {
		return errors.New("开启参考视频计费后，必须配置大于 0 的每秒积分")
	}
	return nil
}

// stringToRaw returns the stored config as a JSON object for the VO, or nil
// (serializes as null) when empty/invalid.
func stringToRaw(s string) json.RawMessage {
	s = strings.TrimSpace(s)
	if s == "" || !json.Valid([]byte(s)) {
		return nil
	}
	return json.RawMessage(s)
}

func pickName(u *model.User) string {
	if u == nil {
		return ""
	}
	if n := strings.TrimSpace(u.Nickname); n != "" {
		return n
	}
	return strings.TrimSpace(u.Username)
}

// parseOptID parses an optional string id; returns nil for "" / "0" / invalid so
// a nullable FK column can be cleared.
func parseOptID(s string) *idgen.ID {
	s = strings.TrimSpace(s)
	if s == "" || s == "0" {
		return nil
	}
	v, err := idgen.Parse(s)
	if err != nil || v == 0 {
		return nil
	}
	return &v
}

// firstNonNil returns the first non-nil string pointer (price preferred over its
// pointCost alias).
func firstNonNil(a, b *string) *string {
	if a != nil {
		return a
	}
	return b
}

// parsePathID extracts and validates the :id path param, writing a 400 on failure.
// Shared by the g3 model + floor handlers.
func parsePathID(c *gin.Context) (idgen.ID, bool) {
	id, err := idgen.Parse(c.Param("id"))
	if err != nil || id == 0 {
		response.Fail(c, response.CodeBadRequest, "invalid id")
		return 0, false
	}
	return id, true
}

// g3FmtTime renders a time as RFC3339, or "" for the zero value.
func g3FmtTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.Format(time.RFC3339)
}
