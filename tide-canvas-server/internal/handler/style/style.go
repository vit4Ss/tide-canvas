// Package style backs the canvas image node's 风格 (style preset) picker.
//
// Routes (all under JWTAuth):
//
//	GET  /api/styles              StylePresetQuery -> PageData<StylePresetVO>
//	POST /api/styles              StylePresetSaveDTO -> StylePresetVO   (owner=user)
//	POST /api/styles/:id/favorite -> { favorited }                     (toggle)
//	POST /api/styles/:id/use      -> void                              (record recent + usageCount++)
//
// Wire shape mirrors tide-canvas-web/src/types/style.ts.
package style

import (
	"encoding/json"
	"errors"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"tidecanvas/internal/app"
	"tidecanvas/internal/middleware"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
)

type handler struct{ db *gorm.DB }

// Register mounts the style routes and seeds the baseline gallery presets.
func Register(api *gin.RouterGroup, d *app.Deps) {
	_ = ensureBaselineStyles(d.DB)
	h := &handler{db: d.DB}
	g := api.Group("/styles")
	g.Use(middleware.JWTAuth(d))
	g.GET("", h.list)
	g.POST("", h.create)
	g.POST("/:id/favorite", h.toggleFavorite)
	g.POST("/:id/use", h.recordUse)
}

// ---- VO / DTO ----

// StylePresetVO mirrors the frontend StylePresetVO (id is idgen.ID → JSON string).
type StylePresetVO struct {
	ID           idgen.ID          `json:"id"`
	Name         string            `json:"name"`
	ShortName    string            `json:"shortName"`
	Description  string            `json:"description"`
	Prompt       string            `json:"prompt"`
	CoverURL     string            `json:"coverUrl"`
	Category     string            `json:"category"`
	AuthorName   string            `json:"authorName"`
	ModelType    string            `json:"modelType"`
	ModelID      string            `json:"modelId"`
	ModelIDs     []string          `json:"modelIds"`
	ModelPrompts map[string]string `json:"modelPrompts"`
	Tags         []string          `json:"tags"`
	Commercial   int               `json:"commercial"`
	PublicFlag   int               `json:"publicFlag"`
	Official     int               `json:"official"`
	Status       int               `json:"status"`
	SortOrder    int               `json:"sortOrder"`
	UsageCount   int               `json:"usageCount"`
	Favorited    bool              `json:"favorited"`
	OwnerType    string            `json:"ownerType"`
	CreateTime   string            `json:"createTime"`
	UpdateTime   string            `json:"updateTime"`
}

// SaveDTO is the create/edit body (StylePresetSaveDTO).
type SaveDTO struct {
	Name         string            `json:"name" binding:"required,max=128"`
	ShortName    string            `json:"shortName" binding:"omitempty,max=64"`
	Description  string            `json:"description" binding:"omitempty,max=512"`
	Prompt       string            `json:"prompt" binding:"required"`
	CoverURL     string            `json:"coverUrl" binding:"omitempty,max=512"`
	Category     string            `json:"category" binding:"omitempty,max=64"`
	AuthorName   string            `json:"authorName" binding:"omitempty,max=64"`
	ModelType    string            `json:"modelType" binding:"omitempty,max=32"`
	ModelID      string            `json:"modelId" binding:"omitempty,max=128"`
	ModelIDs     []string          `json:"modelIds"`
	ModelPrompts map[string]string `json:"modelPrompts"`
	Tags         []string          `json:"tags"`
	Commercial   int               `json:"commercial"`
	PublicFlag   int               `json:"publicFlag"`
	Official     int               `json:"official"`
	Status       int               `json:"status"`
	SortOrder    int               `json:"sortOrder"`
}

// ---- handlers ----

func (h *handler) list(c *gin.Context) {
	uid := middleware.CurrentUserID(c)
	source := c.Query("source")
	keyword := strings.TrimSpace(c.Query("keyword"))
	category := strings.TrimSpace(c.Query("category"))
	commercialOnly := c.Query("commercialOnly") == "true"
	pageNum := atoiDefault(c.Query("pageNum"), 1)
	pageSize := atoiDefault(c.Query("pageSize"), 24)
	if pageNum < 1 {
		pageNum = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 24
	}

	tx := h.db.Model(&model.StylePreset{})
	switch source {
	case "favorite":
		tx = tx.Where("id IN (?)", h.db.Model(&model.StyleFavorite{}).Select("style_id").Where("user_id = ?", uid))
	case "recent":
		tx = tx.Where("id IN (?)", h.db.Model(&model.StyleUsage{}).Select("style_id").Where("user_id = ?", uid))
	case "mine":
		tx = tx.Where("owner_type = ? AND owner_id = ?", "user", uid)
	default: // gallery
		tx = tx.Where("public_flag = 1 AND status = 1")
	}
	if keyword != "" {
		like := "%" + keyword + "%"
		tx = tx.Where("name LIKE ? OR description LIKE ?", like, like)
	}
	// 「推荐」是聚合页签而非真实分类:展示全部(官方优先),不做 category 过滤
	if category != "" && category != "推荐" {
		tx = tx.Where("category = ?", category)
	}
	if commercialOnly {
		tx = tx.Where("commercial = 1")
	}

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		response.Fail(c, response.CodeServerError, "加载风格失败")
		return
	}
	var rows []model.StylePreset
	q := tx.Order("official DESC, sort_order ASC, usage_count DESC, create_time DESC")
	if source == "recent" {
		// 最近使用:按使用时间排序需要 join,简单起见按更新时间近似(用量高在前已在上）。
		q = tx.Order("update_time DESC")
	}
	if err := q.Limit(pageSize).Offset((pageNum - 1) * pageSize).Find(&rows).Error; err != nil {
		response.Fail(c, response.CodeServerError, "加载风格失败")
		return
	}

	favSet := h.favoritedSet(uid, rows)
	vos := make([]StylePresetVO, 0, len(rows))
	for i := range rows {
		vos = append(vos, toStyleVO(&rows[i], favSet[rows[i].ID]))
	}
	response.OK(c, response.PageData[StylePresetVO]{
		Records: vos, Total: total, PageNum: pageNum, PageSize: pageSize,
		Pages: int((total + int64(pageSize) - 1) / int64(pageSize)),
	})
}

func (h *handler) create(c *gin.Context) {
	uid := middleware.CurrentUserID(c)
	var dto SaveDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}
	row := model.StylePreset{
		Name:         strings.TrimSpace(dto.Name),
		ShortName:    strings.TrimSpace(dto.ShortName),
		Description:  strings.TrimSpace(dto.Description),
		Prompt:       dto.Prompt,
		CoverURL:     dto.CoverURL,
		Category:     dto.Category,
		AuthorName:   dto.AuthorName,
		ModelType:    dto.ModelType,
		ModelIDs:     encodeJSON(dto.ModelIDs),
		ModelPrompts: encodeJSON(dto.ModelPrompts),
		Tags:         encodeJSON(dto.Tags),
		Commercial:   dto.Commercial,
		PublicFlag:   dto.PublicFlag,
		Official:     0, // 用户创建不能自封官方
		Status:       1,
		SortOrder:    dto.SortOrder,
		OwnerType:    "user",
		OwnerID:      uid,
	}
	// modelId 单值仅用于 VO 回显,统一存入 modelIds(保持一处真源)。
	if mid := strings.TrimSpace(dto.ModelID); mid != "" && len(dto.ModelIDs) == 0 {
		row.ModelIDs = encodeJSON([]string{mid})
	}
	if err := h.db.Create(&row).Error; err != nil {
		response.Fail(c, response.CodeServerError, "创建风格失败")
		return
	}
	response.OK(c, toStyleVO(&row, false))
}

func (h *handler) toggleFavorite(c *gin.Context) {
	uid := middleware.CurrentUserID(c)
	id, ok := parseID(c)
	if !ok {
		return
	}
	var existing model.StyleFavorite
	err := h.db.Where("user_id = ? AND style_id = ?", uid, id).First(&existing).Error
	if err == nil {
		// 已收藏 → 取消(硬删除,避免唯一索引与软删冲突)。
		h.db.Where("id = ?", existing.ID).Delete(&model.StyleFavorite{})
		response.OK(c, gin.H{"favorited": false})
		return
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		response.Fail(c, response.CodeServerError, "操作失败")
		return
	}
	if e := h.db.Create(&model.StyleFavorite{UserID: uid, StyleID: id}).Error; e != nil {
		response.Fail(c, response.CodeServerError, "操作失败")
		return
	}
	response.OK(c, gin.H{"favorited": true})
}

func (h *handler) recordUse(c *gin.Context) {
	uid := middleware.CurrentUserID(c)
	id, ok := parseID(c)
	if !ok {
		return
	}
	// 记录最近使用(存在则 bump update_time)+ 计数 +1。
	var u model.StyleUsage
	if err := h.db.Where("user_id = ? AND style_id = ?", uid, id).First(&u).Error; err == nil {
		h.db.Model(&model.StyleUsage{}).Where("id = ?", u.ID).Update("update_time", gorm.Expr("CURRENT_TIMESTAMP"))
	} else if errors.Is(err, gorm.ErrRecordNotFound) {
		_ = h.db.Create(&model.StyleUsage{UserID: uid, StyleID: id}).Error
	}
	h.db.Model(&model.StylePreset{}).Where("id = ?", id).UpdateColumn("usage_count", gorm.Expr("usage_count + 1"))
	response.OK[any](c, nil)
}

// ---- helpers ----

// favoritedSet returns the set of style ids the user favorited among rows.
func (h *handler) favoritedSet(uid idgen.ID, rows []model.StylePreset) map[idgen.ID]bool {
	set := map[idgen.ID]bool{}
	if uid == 0 || len(rows) == 0 {
		return set
	}
	ids := make([]idgen.ID, len(rows))
	for i := range rows {
		ids[i] = rows[i].ID
	}
	var favs []model.StyleFavorite
	h.db.Where("user_id = ? AND style_id IN ?", uid, ids).Find(&favs)
	for i := range favs {
		set[favs[i].StyleID] = true
	}
	return set
}

func toStyleVO(m *model.StylePreset, favorited bool) StylePresetVO {
	ids := decodeJSONArray(m.ModelIDs)
	modelID := ""
	if len(ids) > 0 {
		modelID = ids[0]
	}
	return StylePresetVO{
		ID:           m.ID,
		Name:         m.Name,
		ShortName:    m.ShortName,
		Description:  m.Description,
		Prompt:       m.Prompt,
		CoverURL:     m.CoverURL,
		Category:     m.Category,
		AuthorName:   m.AuthorName,
		ModelType:    m.ModelType,
		ModelID:      modelID,
		ModelIDs:     ids,
		ModelPrompts: decodeJSONMap(m.ModelPrompts),
		Tags:         decodeJSONArray(m.Tags),
		Commercial:   m.Commercial,
		PublicFlag:   m.PublicFlag,
		Official:     m.Official,
		Status:       m.Status,
		SortOrder:    m.SortOrder,
		UsageCount:   m.UsageCount,
		Favorited:    favorited,
		OwnerType:    m.OwnerType,
		CreateTime:   m.CreateTime.Format("2006-01-02 15:04:05"),
		UpdateTime:   m.UpdateTime.Format("2006-01-02 15:04:05"),
	}
}

func parseID(c *gin.Context) (idgen.ID, bool) {
	id, err := idgen.Parse(strings.TrimSpace(c.Param("id")))
	if err != nil || id == 0 {
		response.Fail(c, response.CodeBadRequest, "无效的 id")
		return 0, false
	}
	return id, true
}

func atoiDefault(s string, def int) int {
	if s == "" {
		return def
	}
	n := 0
	for _, r := range s {
		if r < '0' || r > '9' {
			return def
		}
		n = n*10 + int(r-'0')
	}
	return n
}

func encodeJSON(v any) string {
	b, err := json.Marshal(v)
	if err != nil || string(b) == "null" {
		return ""
	}
	return string(b)
}

func decodeJSONArray(raw string) []string {
	out := []string{}
	s := strings.TrimSpace(raw)
	if s == "" || s[0] != '[' {
		return out
	}
	_ = json.Unmarshal([]byte(s), &out)
	if out == nil {
		out = []string{}
	}
	return out
}

func decodeJSONMap(raw string) map[string]string {
	out := map[string]string{}
	s := strings.TrimSpace(raw)
	if s == "" || s[0] != '{' {
		return out
	}
	_ = json.Unmarshal([]byte(s), &out)
	if out == nil {
		out = map[string]string{}
	}
	return out
}
