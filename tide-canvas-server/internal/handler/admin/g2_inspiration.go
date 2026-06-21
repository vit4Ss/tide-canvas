package admin

import (
	"errors"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"tidecanvas/internal/app"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
)

// g2_inspiration.go is the admin "灵感" section: CRUD over the Collection
// (灵感合集 / 主题 / 提示词包) and PromptLib (提示词库) tables seeded by the models
// step. These back the admin-only curation screens.

// RegisterInspiration mounts the admin inspiration routes on the admin group g
// (already gated by JWTAuth + AdminOnly upstream).
//
//	GET    /inspiration/collections          g2PageQuery -> PageData<CollectionVO>
//	POST   /inspiration/collections          CollectionUpsertDTO -> CollectionVO
//	PUT    /inspiration/collections/:id      CollectionUpsertDTO -> CollectionVO
//	DELETE /inspiration/collections/:id      -> void
//	GET    /inspiration/prompts              g2PageQuery -> PageData<PromptVO>
//	POST   /inspiration/prompts              PromptUpsertDTO -> PromptVO
//	PUT    /inspiration/prompts/:id          PromptUpsertDTO -> PromptVO
//	DELETE /inspiration/prompts/:id          -> void
func RegisterInspiration(g *gin.RouterGroup, d *app.Deps) {
	h := &inspirationHandler{db: d.DB}

	ins := g.Group("/inspiration")
	ins.GET("/collections", h.listCollections)
	ins.POST("/collections", h.createCollection)
	ins.PUT("/collections/:id", h.updateCollection)
	ins.DELETE("/collections/:id", h.deleteCollection)

	ins.GET("/prompts", h.listPrompts)
	ins.POST("/prompts", h.createPrompt)
	ins.PUT("/prompts/:id", h.updatePrompt)
	ins.DELETE("/prompts/:id", h.deletePrompt)
}

type inspirationHandler struct {
	db *gorm.DB
}

// --- shared paged query ---

// g2PageQuery is the shared paged/keyword query for the inspiration lists.
type g2PageQuery struct {
	PageNum  int    `form:"pageNum"`
	PageSize int    `form:"pageSize"`
	Keyword  string `form:"keyword"`
	Type     string `form:"type"` // collections only: 合集/主题/提示词
}

func (q *g2PageQuery) normalize() {
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
	q.Type = strings.TrimSpace(q.Type)
}

func (q *g2PageQuery) offset() int { return (q.PageNum - 1) * q.PageSize }

// --- Collection VO / DTO ---

// CollectionVO is the admin row view of a curated inspiration collection.
//
//	{id,title,type,coverUrl,linkedWorks,sortOrder,visible,tags,description,createTime,updateTime}
type CollectionVO struct {
	ID          idgen.ID `json:"id"`
	Title       string   `json:"title"`
	Type        string   `json:"type"`
	CoverURL    string   `json:"coverUrl"`
	LinkedWorks int      `json:"linkedWorks"`
	SortOrder   int      `json:"sortOrder"`
	Visible     bool     `json:"visible"`
	Tags        string   `json:"tags"`
	Description string   `json:"description"`
	CreateTime  string   `json:"createTime"`
	UpdateTime  string   `json:"updateTime"`
}

// CollectionUpsertDTO is the body for create/update of a collection. Pointers on
// the optional flags so an absent field is preserved on update.
type CollectionUpsertDTO struct {
	Title       string  `json:"title" binding:"required,max=128"`
	Type        string  `json:"type" binding:"omitempty,max=16"`
	CoverURL    string  `json:"coverUrl" binding:"omitempty,max=512"`
	LinkedWorks *int    `json:"linkedWorks"`
	SortOrder   *int    `json:"sortOrder"`
	Visible     *bool   `json:"visible"`
	Tags        *string `json:"tags"`
	Description *string `json:"description"`
}

func toCollectionVO(m *model.Collection) CollectionVO {
	return CollectionVO{
		ID:          m.ID,
		Title:       m.Title,
		Type:        m.Type,
		CoverURL:    m.CoverURL,
		LinkedWorks: m.LinkedWorks,
		SortOrder:   m.SortOrder,
		Visible:     m.Visible,
		Tags:        m.Tags,
		Description: m.Description,
		CreateTime:  g2FormatTime(m.CreateTime),
		UpdateTime:  g2FormatTime(m.UpdateTime),
	}
}

// --- Prompt VO / DTO ---

// PromptVO is the admin row view of a prompt-library entry.
//
//	{id,text,tags,adoptions,coverUrl,createTime,updateTime}
type PromptVO struct {
	ID         idgen.ID `json:"id"`
	Text       string   `json:"text"`
	Tags       string   `json:"tags"`
	Adoptions  int      `json:"adoptions"`
	CoverURL   string   `json:"coverUrl"`
	CreateTime string   `json:"createTime"`
	UpdateTime string   `json:"updateTime"`
}

// PromptUpsertDTO is the body for create/update of a prompt-library entry.
type PromptUpsertDTO struct {
	Text      string  `json:"text" binding:"required"`
	Tags      *string `json:"tags"`
	Adoptions *int    `json:"adoptions"`
	CoverURL  string  `json:"coverUrl" binding:"omitempty,max=512"`
}

func toPromptVO(m *model.PromptLib) PromptVO {
	return PromptVO{
		ID:         m.ID,
		Text:       m.Text,
		Tags:       m.Tags,
		Adoptions:  m.Adoptions,
		CoverURL:   m.CoverURL,
		CreateTime: g2FormatTime(m.CreateTime),
		UpdateTime: g2FormatTime(m.UpdateTime),
	}
}

// --- collection handlers ---

func (h *inspirationHandler) listCollections(c *gin.Context) {
	var q g2PageQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid query: "+err.Error())
		return
	}
	q.normalize()

	tx := h.db.Model(&model.Collection{})
	if q.Type != "" {
		tx = tx.Where("type = ?", q.Type)
	}
	if q.Keyword != "" {
		like := "%" + g2EscapeLike(q.Keyword) + "%"
		tx = tx.Where("title LIKE ? OR description LIKE ? OR tags LIKE ?", like, like, like)
	}

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to list collections")
		return
	}

	var rows []model.Collection
	if err := tx.Order("sort_order ASC, create_time DESC").
		Limit(q.PageSize).Offset(q.offset()).Find(&rows).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to list collections")
		return
	}

	vos := make([]CollectionVO, 0, len(rows))
	for i := range rows {
		vos = append(vos, toCollectionVO(&rows[i]))
	}
	response.Page(c, vos, total, q.PageNum, q.PageSize)
}

func (h *inspirationHandler) createCollection(c *gin.Context) {
	var dto CollectionUpsertDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}

	row := model.Collection{
		Title:    strings.TrimSpace(dto.Title),
		Type:     "合集",
		CoverURL: dto.CoverURL,
		Visible:  true,
	}
	if t := strings.TrimSpace(dto.Type); t != "" {
		row.Type = t
	}
	if dto.LinkedWorks != nil {
		row.LinkedWorks = *dto.LinkedWorks
	}
	if dto.SortOrder != nil {
		row.SortOrder = *dto.SortOrder
	}
	if dto.Visible != nil {
		row.Visible = *dto.Visible
	}
	if dto.Tags != nil {
		row.Tags = *dto.Tags
	}
	if dto.Description != nil {
		row.Description = *dto.Description
	}

	if err := h.db.Create(&row).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to create collection")
		return
	}
	response.OK(c, toCollectionVO(&row))
}

func (h *inspirationHandler) updateCollection(c *gin.Context) {
	id, ok := parseInspirationID(c)
	if !ok {
		return
	}
	var dto CollectionUpsertDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}

	var row model.Collection
	if err := h.db.Where("id = ?", id).First(&row).Error; err != nil {
		h.failLookup(c, err, "collection")
		return
	}

	updates := map[string]any{"title": strings.TrimSpace(dto.Title)}
	if t := strings.TrimSpace(dto.Type); t != "" {
		updates["type"] = t
	}
	updates["cover_url"] = dto.CoverURL
	if dto.LinkedWorks != nil {
		updates["linked_works"] = *dto.LinkedWorks
	}
	if dto.SortOrder != nil {
		updates["sort_order"] = *dto.SortOrder
	}
	if dto.Visible != nil {
		updates["visible"] = *dto.Visible
	}
	if dto.Tags != nil {
		updates["tags"] = *dto.Tags
	}
	if dto.Description != nil {
		updates["description"] = *dto.Description
	}

	if err := h.db.Model(&model.Collection{}).Where("id = ?", id).Updates(updates).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to update collection")
		return
	}
	if err := h.db.Where("id = ?", id).First(&row).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to reload collection")
		return
	}
	response.OK(c, toCollectionVO(&row))
}

func (h *inspirationHandler) deleteCollection(c *gin.Context) {
	id, ok := parseInspirationID(c)
	if !ok {
		return
	}
	res := h.db.Where("id = ?", id).Delete(&model.Collection{})
	if res.Error != nil {
		response.Fail(c, response.CodeServerError, "failed to delete collection")
		return
	}
	if res.RowsAffected == 0 {
		response.Fail(c, response.CodeNotFound, "collection not found")
		return
	}
	response.OK[any](c, nil)
}

// --- prompt handlers ---

func (h *inspirationHandler) listPrompts(c *gin.Context) {
	var q g2PageQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid query: "+err.Error())
		return
	}
	q.normalize()

	tx := h.db.Model(&model.PromptLib{})
	if q.Keyword != "" {
		like := "%" + g2EscapeLike(q.Keyword) + "%"
		tx = tx.Where("text LIKE ? OR tags LIKE ?", like, like)
	}

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to list prompts")
		return
	}

	var rows []model.PromptLib
	if err := tx.Order("adoptions DESC, create_time DESC").
		Limit(q.PageSize).Offset(q.offset()).Find(&rows).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to list prompts")
		return
	}

	vos := make([]PromptVO, 0, len(rows))
	for i := range rows {
		vos = append(vos, toPromptVO(&rows[i]))
	}
	response.Page(c, vos, total, q.PageNum, q.PageSize)
}

func (h *inspirationHandler) createPrompt(c *gin.Context) {
	var dto PromptUpsertDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}

	row := model.PromptLib{
		Text:     strings.TrimSpace(dto.Text),
		CoverURL: dto.CoverURL,
	}
	if dto.Tags != nil {
		row.Tags = *dto.Tags
	}
	if dto.Adoptions != nil {
		row.Adoptions = *dto.Adoptions
	}

	if err := h.db.Create(&row).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to create prompt")
		return
	}
	response.OK(c, toPromptVO(&row))
}

func (h *inspirationHandler) updatePrompt(c *gin.Context) {
	id, ok := parseInspirationID(c)
	if !ok {
		return
	}
	var dto PromptUpsertDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}

	var row model.PromptLib
	if err := h.db.Where("id = ?", id).First(&row).Error; err != nil {
		h.failLookup(c, err, "prompt")
		return
	}

	updates := map[string]any{
		"text":      strings.TrimSpace(dto.Text),
		"cover_url": dto.CoverURL,
	}
	if dto.Tags != nil {
		updates["tags"] = *dto.Tags
	}
	if dto.Adoptions != nil {
		updates["adoptions"] = *dto.Adoptions
	}

	if err := h.db.Model(&model.PromptLib{}).Where("id = ?", id).Updates(updates).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to update prompt")
		return
	}
	if err := h.db.Where("id = ?", id).First(&row).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to reload prompt")
		return
	}
	response.OK(c, toPromptVO(&row))
}

func (h *inspirationHandler) deletePrompt(c *gin.Context) {
	id, ok := parseInspirationID(c)
	if !ok {
		return
	}
	res := h.db.Where("id = ?", id).Delete(&model.PromptLib{})
	if res.Error != nil {
		response.Fail(c, response.CodeServerError, "failed to delete prompt")
		return
	}
	if res.RowsAffected == 0 {
		response.Fail(c, response.CodeNotFound, "prompt not found")
		return
	}
	response.OK[any](c, nil)
}

// --- helpers ---

func (h *inspirationHandler) failLookup(c *gin.Context, err error, what string) {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		response.Fail(c, response.CodeNotFound, what+" not found")
		return
	}
	response.Fail(c, response.CodeServerError, "failed to load "+what)
}

// parseInspirationID extracts and validates the :id path param.
func parseInspirationID(c *gin.Context) (idgen.ID, bool) {
	id, err := idgen.Parse(c.Param("id"))
	if err != nil || id == 0 {
		response.Fail(c, response.CodeBadRequest, "invalid id")
		return 0, false
	}
	return id, true
}
