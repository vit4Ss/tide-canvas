// g2_styles.go — 后台「风格管理」：维护画布图片节点风格选择器(风格广场)的预设。
//
// Routes (JWTAuth + AdminOnly upstream):
//
//	GET    /api/admin/styles      list w/ pagination + keyword/category/status/ownerType filters
//	POST   /api/admin/styles      create (owner=system, 可设 official/排序/上下架)
//	PUT    /api/admin/styles/:id  update
//	DELETE /api/admin/styles/:id  delete (级联清收藏与最近使用记录)
//
// Wire shape 与用户端 /api/styles (handler/style) 及前端 types/style.ts 对齐。
package admin

import (
	"encoding/json"
	"errors"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"tidecanvas/internal/app"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
)

type stylesHandler struct{ db *gorm.DB }

// RegisterStyles mounts the admin style-preset routes on the admin group g.
func RegisterStyles(g *gin.RouterGroup, d *app.Deps) {
	h := &stylesHandler{db: d.DB}
	s := g.Group("/styles")
	s.GET("", h.list)
	s.POST("", h.create)
	s.PUT("/:id", h.update)
	s.DELETE("/:id", h.remove)
}

// ---- VO / DTO ----

// AdminStyleVO mirrors 前端 StylePresetVO(后台维护页与用户端选择器共用类型)。
type AdminStyleVO struct {
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

// AdminStyleSaveDTO is the create/update body (前端 StylePresetSaveDTO)。
type AdminStyleSaveDTO struct {
	Name         string            `json:"name" binding:"required,max=128"`
	ShortName    string            `json:"shortName" binding:"omitempty,max=64"`
	Description  string            `json:"description" binding:"omitempty,max=512"`
	Prompt       string            `json:"prompt" binding:"required"`
	CoverURL     string            `json:"coverUrl" binding:"omitempty,max=512"`
	Category     string            `json:"category" binding:"omitempty,max=64"`
	AuthorName   string            `json:"authorName" binding:"omitempty,max=64"`
	ModelType    string            `json:"modelType" binding:"omitempty,max=32"`
	ModelIDs     []string          `json:"modelIds"`
	ModelPrompts map[string]string `json:"modelPrompts"`
	Tags         []string          `json:"tags"`
	Commercial   *int              `json:"commercial"`
	PublicFlag   *int              `json:"publicFlag"`
	Official     *int              `json:"official"`
	Status       *int              `json:"status"`
	SortOrder    *int              `json:"sortOrder"`
}

type stylesQuery struct {
	PageNum   int    `form:"pageNum"`
	PageSize  int    `form:"pageSize"`
	Keyword   string `form:"keyword"`
	Category  string `form:"category"`
	Status    string `form:"status"`    // "" | "0" | "1"
	OwnerType string `form:"ownerType"` // "" | system | user
}

func (q *stylesQuery) normalize() {
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
	q.Category = strings.TrimSpace(q.Category)
	q.Status = strings.TrimSpace(q.Status)
	q.OwnerType = strings.TrimSpace(q.OwnerType)
}

// ---- handlers ----

func (h *stylesHandler) list(c *gin.Context) {
	var q stylesQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid query: "+err.Error())
		return
	}
	q.normalize()

	tx := h.db.Model(&model.StylePreset{})
	if q.Keyword != "" {
		like := "%" + g2EscapeLike(q.Keyword) + "%"
		tx = tx.Where("name LIKE ? OR short_name LIKE ? OR description LIKE ? OR author_name LIKE ?", like, like, like, like)
	}
	if q.Category != "" {
		tx = tx.Where("category = ?", q.Category)
	}
	if q.Status == "0" || q.Status == "1" {
		tx = tx.Where("status = ?", q.Status)
	}
	if q.OwnerType != "" {
		tx = tx.Where("owner_type = ?", q.OwnerType)
	}

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		response.Fail(c, response.CodeServerError, "加载风格列表失败")
		return
	}
	var rows []model.StylePreset
	if err := tx.Order("official DESC, sort_order ASC, create_time DESC").
		Limit(q.PageSize).Offset((q.PageNum - 1) * q.PageSize).Find(&rows).Error; err != nil {
		response.Fail(c, response.CodeServerError, "加载风格列表失败")
		return
	}
	vos := make([]AdminStyleVO, 0, len(rows))
	for i := range rows {
		vos = append(vos, toAdminStyleVO(&rows[i]))
	}
	response.Page(c, vos, total, q.PageNum, q.PageSize)
}

func (h *stylesHandler) create(c *gin.Context) {
	var dto AdminStyleSaveDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}
	row := model.StylePreset{
		Name:         strings.TrimSpace(dto.Name),
		ShortName:    strings.TrimSpace(dto.ShortName),
		Description:  strings.TrimSpace(dto.Description),
		Prompt:       dto.Prompt,
		CoverURL:     strings.TrimSpace(dto.CoverURL),
		Category:     strings.TrimSpace(dto.Category),
		AuthorName:   strings.TrimSpace(dto.AuthorName),
		ModelType:    strings.TrimSpace(dto.ModelType),
		ModelIDs:     stylesEncodeJSON(dto.ModelIDs),
		ModelPrompts: stylesEncodeJSON(dto.ModelPrompts),
		Tags:         stylesEncodeJSON(dto.Tags),
		OwnerType:    "system",
	}
	if row.AuthorName == "" {
		row.AuthorName = "官方"
	}
	if row.ModelType == "" {
		row.ModelType = "image"
	}
	// 缺省:可商用不勾、公开上架、非官方;零值列强制写入避免被 DB default 覆盖
	forced := map[string]any{
		"commercial":  intOrDefault(dto.Commercial, 0),
		"public_flag": intOrDefault(dto.PublicFlag, 1),
		"official":    intOrDefault(dto.Official, 0),
		"status":      intOrDefault(dto.Status, 1),
		"sort_order":  intOrDefault(dto.SortOrder, 0),
	}
	row.Commercial = forced["commercial"].(int)
	row.PublicFlag = forced["public_flag"].(int)
	row.Official = forced["official"].(int)
	row.Status = forced["status"].(int)
	row.SortOrder = forced["sort_order"].(int)
	if err := adminCreateRow(h.db, &row, forced); err != nil {
		response.Fail(c, response.CodeServerError, "创建风格失败")
		return
	}
	response.OK(c, toAdminStyleVO(&row))
}

func (h *stylesHandler) update(c *gin.Context) {
	id, ok := parseStyleID(c)
	if !ok {
		return
	}
	var dto AdminStyleSaveDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}
	var row model.StylePreset
	if err := h.db.Where("id = ?", id).First(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			response.Fail(c, response.CodeNotFound, "风格不存在")
			return
		}
		response.Fail(c, response.CodeServerError, "加载风格失败")
		return
	}

	updates := map[string]any{
		"name":          strings.TrimSpace(dto.Name),
		"short_name":    strings.TrimSpace(dto.ShortName),
		"description":   strings.TrimSpace(dto.Description),
		"prompt":        dto.Prompt,
		"cover_url":     strings.TrimSpace(dto.CoverURL),
		"category":      strings.TrimSpace(dto.Category),
		"author_name":   strings.TrimSpace(dto.AuthorName),
		"model_type":    strings.TrimSpace(dto.ModelType),
		"model_ids":     stylesEncodeJSON(dto.ModelIDs),
		"model_prompts": stylesEncodeJSON(dto.ModelPrompts),
		"tags":          stylesEncodeJSON(dto.Tags),
	}
	if dto.Commercial != nil {
		updates["commercial"] = *dto.Commercial
	}
	if dto.PublicFlag != nil {
		updates["public_flag"] = *dto.PublicFlag
	}
	if dto.Official != nil {
		updates["official"] = *dto.Official
	}
	if dto.Status != nil {
		updates["status"] = *dto.Status
	}
	if dto.SortOrder != nil {
		updates["sort_order"] = *dto.SortOrder
	}
	if err := h.db.Model(&model.StylePreset{}).Where("id = ?", id).Updates(updates).Error; err != nil {
		response.Fail(c, response.CodeServerError, "更新风格失败")
		return
	}
	if err := h.db.Where("id = ?", id).First(&row).Error; err != nil {
		response.Fail(c, response.CodeServerError, "重新加载风格失败")
		return
	}
	response.OK(c, toAdminStyleVO(&row))
}

func (h *stylesHandler) remove(c *gin.Context) {
	id, ok := parseStyleID(c)
	if !ok {
		return
	}
	res := h.db.Where("id = ?", id).Delete(&model.StylePreset{})
	if res.Error != nil {
		response.Fail(c, response.CodeServerError, "删除风格失败")
		return
	}
	if res.RowsAffected == 0 {
		response.Fail(c, response.CodeNotFound, "风格不存在")
		return
	}
	// 级联清理收藏与最近使用,避免悬挂引用
	h.db.Where("style_id = ?", id).Delete(&model.StyleFavorite{})
	h.db.Where("style_id = ?", id).Delete(&model.StyleUsage{})
	response.OK[any](c, nil)
}

// ---- helpers ----

func toAdminStyleVO(m *model.StylePreset) AdminStyleVO {
	ids := stylesDecodeArray(m.ModelIDs)
	modelID := ""
	if len(ids) > 0 {
		modelID = ids[0]
	}
	return AdminStyleVO{
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
		ModelPrompts: stylesDecodeMap(m.ModelPrompts),
		Tags:         stylesDecodeArray(m.Tags),
		Commercial:   m.Commercial,
		PublicFlag:   m.PublicFlag,
		Official:     m.Official,
		Status:       m.Status,
		SortOrder:    m.SortOrder,
		UsageCount:   m.UsageCount,
		OwnerType:    m.OwnerType,
		CreateTime:   m.CreateTime.Format("2006-01-02 15:04:05"),
		UpdateTime:   m.UpdateTime.Format("2006-01-02 15:04:05"),
	}
}

func parseStyleID(c *gin.Context) (idgen.ID, bool) {
	id, err := idgen.Parse(strings.TrimSpace(c.Param("id")))
	if err != nil || id == 0 {
		response.Fail(c, response.CodeBadRequest, "无效的 id")
		return 0, false
	}
	return id, true
}

func intOrDefault(p *int, def int) int {
	if p != nil {
		return *p
	}
	return def
}

func stylesEncodeJSON(v any) string {
	b, err := json.Marshal(v)
	if err != nil || string(b) == "null" {
		return ""
	}
	return string(b)
}

func stylesDecodeArray(raw string) []string {
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

func stylesDecodeMap(raw string) map[string]string {
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
