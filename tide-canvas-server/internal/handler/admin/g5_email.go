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

// g5_email.go: admin email management — transactional templates
// (model.EmailTemplate) and developer API keys (model.ApiKey). Full CRUD on both.

// ---- EmailTemplate VO / DTO ----

// EmailTemplateVO is the list/detail view of an email template.
type EmailTemplateVO struct {
	ID        idgen.ID `json:"id"`
	Name      string   `json:"name"`
	Type      string   `json:"type"`
	Scene     string   `json:"scene"`
	Variables string   `json:"variables"`
	Subject   string   `json:"subject"`
	Body      string   `json:"body"`
	Enabled   bool     `json:"enabled"`
}

func toEmailTemplateVO(m *model.EmailTemplate) EmailTemplateVO {
	return EmailTemplateVO{
		ID:        m.ID,
		Name:      m.Name,
		Type:      m.Type,
		Scene:     m.Scene,
		Variables: m.Variables,
		Subject:   m.Subject,
		Body:      m.Body,
		Enabled:   m.Enabled,
	}
}

// EmailTemplateDTO is the create/update body for an email template.
type EmailTemplateDTO struct {
	Name      string `json:"name" binding:"required,max=128"`
	Type      string `json:"type"`
	Scene     string `json:"scene"`
	Variables string `json:"variables"`
	Subject   string `json:"subject"`
	Body      string `json:"body"`
	Enabled   *bool  `json:"enabled"`
}

// ---- ApiKey VO / DTO ----

// ApiKeyVO is the list/detail view of an API key.
type ApiKeyVO struct {
	ID         idgen.ID `json:"id"`
	Name       string   `json:"name"`
	Scope      string   `json:"scope"`
	KeyValue   string   `json:"keyValue"`
	DailyLimit int      `json:"dailyLimit"`
	Expiry     string   `json:"expiry"`
	Enabled    bool     `json:"enabled"`
}

func toApiKeyVO(m *model.ApiKey) ApiKeyVO {
	return ApiKeyVO{
		ID:         m.ID,
		Name:       m.Name,
		Scope:      m.Scope,
		KeyValue:   m.KeyValue,
		DailyLimit: m.DailyLimit,
		Expiry:     g5FmtTime(m.Expiry),
		Enabled:    m.Enabled,
	}
}

// ApiKeyDTO is the create/update body for an API key. KeyValue is optional on
// create (auto-minted when blank); Expiry is an optional datetime string.
type ApiKeyDTO struct {
	Name       string  `json:"name" binding:"required,max=128"`
	Scope      string  `json:"scope"`
	KeyValue   string  `json:"keyValue"`
	DailyLimit *int    `json:"dailyLimit"`
	Expiry     *string `json:"expiry"`
	Enabled    *bool   `json:"enabled"`
}

// RegisterEmail mounts the email admin routes on the admin group.
//
//	GET    /email/templates        g5PageQuery -> PageData<EmailTemplateVO>
//	POST   /email/templates        EmailTemplateDTO -> EmailTemplateVO
//	PUT    /email/templates/:id    EmailTemplateDTO -> EmailTemplateVO
//	DELETE /email/templates/:id    -> void
//	GET    /email/api-keys         g5PageQuery -> PageData<ApiKeyVO>
//	POST   /email/api-keys         ApiKeyDTO -> ApiKeyVO
//	PUT    /email/api-keys/:id     ApiKeyDTO -> ApiKeyVO
//	DELETE /email/api-keys/:id     -> void
func RegisterEmail(g *gin.RouterGroup, d *app.Deps) {
	db := d.DB

	e := g.Group("/email")

	// Templates.
	e.GET("/templates", func(c *gin.Context) {
		var q g5PageQuery
		if err := c.ShouldBindQuery(&q); err != nil {
			response.Fail(c, response.CodeBadRequest, "invalid query: "+err.Error())
			return
		}
		q.normalize()

		tx := db.Model(&model.EmailTemplate{})
		if q.Keyword != "" {
			tx = tx.Where("name LIKE ? OR subject LIKE ?", "%"+q.Keyword+"%", "%"+q.Keyword+"%")
		}
		if q.Scene != "" {
			tx = tx.Where("scene = ?", q.Scene)
		}
		if q.Type != "" {
			tx = tx.Where("type = ?", q.Type)
		}

		var total int64
		if err := tx.Count(&total).Error; err != nil {
			response.Fail(c, response.CodeServerError, "failed to count templates")
			return
		}
		var rows []model.EmailTemplate
		if err := tx.Order("create_time DESC").Limit(q.PageSize).Offset(q.offset()).Find(&rows).Error; err != nil {
			response.Fail(c, response.CodeServerError, "failed to list templates")
			return
		}
		vos := make([]EmailTemplateVO, 0, len(rows))
		for i := range rows {
			vos = append(vos, toEmailTemplateVO(&rows[i]))
		}
		response.Page(c, vos, total, q.PageNum, q.PageSize)
	})

	e.POST("/templates", func(c *gin.Context) {
		var dto EmailTemplateDTO
		if err := c.ShouldBindJSON(&dto); err != nil {
			response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
			return
		}
		row := model.EmailTemplate{
			Name:      strings.TrimSpace(dto.Name),
			Type:      g5Default(dto.Type, "html"),
			Scene:     dto.Scene,
			Variables: dto.Variables,
			Subject:   dto.Subject,
			Body:      dto.Body,
			Enabled:   dto.Enabled == nil || *dto.Enabled,
		}
		if err := db.Create(&row).Error; err != nil {
			response.Fail(c, response.CodeServerError, "failed to create template")
			return
		}
		response.OK(c, toEmailTemplateVO(&row))
	})

	e.PUT("/templates/:id", func(c *gin.Context) {
		id, ok := g5ParseID(c)
		if !ok {
			return
		}
		var dto EmailTemplateDTO
		if err := c.ShouldBindJSON(&dto); err != nil {
			response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
			return
		}
		var row model.EmailTemplate
		if err := db.First(&row, "id = ?", id).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				response.Fail(c, response.CodeNotFound, "template not found")
				return
			}
			response.Fail(c, response.CodeServerError, "failed to load template")
			return
		}
		row.Name = strings.TrimSpace(dto.Name)
		if dto.Type != "" {
			row.Type = dto.Type
		}
		row.Scene = dto.Scene
		row.Variables = dto.Variables
		row.Subject = dto.Subject
		row.Body = dto.Body
		if dto.Enabled != nil {
			row.Enabled = *dto.Enabled
		}
		if err := db.Save(&row).Error; err != nil {
			response.Fail(c, response.CodeServerError, "failed to update template")
			return
		}
		response.OK(c, toEmailTemplateVO(&row))
	})

	e.DELETE("/templates/:id", func(c *gin.Context) {
		id, ok := g5ParseID(c)
		if !ok {
			return
		}
		res := db.Where("id = ?", id).Delete(&model.EmailTemplate{})
		if res.Error != nil {
			response.Fail(c, response.CodeServerError, "failed to delete template")
			return
		}
		if res.RowsAffected == 0 {
			response.Fail(c, response.CodeNotFound, "template not found")
			return
		}
		response.OK[any](c, nil)
	})

	// API keys.
	e.GET("/api-keys", func(c *gin.Context) {
		var q g5PageQuery
		if err := c.ShouldBindQuery(&q); err != nil {
			response.Fail(c, response.CodeBadRequest, "invalid query: "+err.Error())
			return
		}
		q.normalize()

		tx := db.Model(&model.ApiKey{})
		if q.Keyword != "" {
			tx = tx.Where("name LIKE ?", "%"+q.Keyword+"%")
		}

		var total int64
		if err := tx.Count(&total).Error; err != nil {
			response.Fail(c, response.CodeServerError, "failed to count api keys")
			return
		}
		var rows []model.ApiKey
		if err := tx.Order("create_time DESC").Limit(q.PageSize).Offset(q.offset()).Find(&rows).Error; err != nil {
			response.Fail(c, response.CodeServerError, "failed to list api keys")
			return
		}
		vos := make([]ApiKeyVO, 0, len(rows))
		for i := range rows {
			vos = append(vos, toApiKeyVO(&rows[i]))
		}
		response.Page(c, vos, total, q.PageNum, q.PageSize)
	})

	e.POST("/api-keys", func(c *gin.Context) {
		var dto ApiKeyDTO
		if err := c.ShouldBindJSON(&dto); err != nil {
			response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
			return
		}
		key := strings.TrimSpace(dto.KeyValue)
		if key == "" {
			key = g5RandToken()
		}
		row := model.ApiKey{
			Name:     strings.TrimSpace(dto.Name),
			Scope:    dto.Scope,
			KeyValue: key,
			Enabled:  dto.Enabled == nil || *dto.Enabled,
		}
		if dto.DailyLimit != nil {
			row.DailyLimit = *dto.DailyLimit
		}
		if dto.Expiry != nil {
			row.Expiry = g5ParseTime(dto.Expiry)
		}
		if err := db.Create(&row).Error; err != nil {
			response.Fail(c, response.CodeServerError, "failed to create api key")
			return
		}
		response.OK(c, toApiKeyVO(&row))
	})

	e.PUT("/api-keys/:id", func(c *gin.Context) {
		id, ok := g5ParseID(c)
		if !ok {
			return
		}
		var dto ApiKeyDTO
		if err := c.ShouldBindJSON(&dto); err != nil {
			response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
			return
		}
		var row model.ApiKey
		if err := db.First(&row, "id = ?", id).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				response.Fail(c, response.CodeNotFound, "api key not found")
				return
			}
			response.Fail(c, response.CodeServerError, "failed to load api key")
			return
		}
		row.Name = strings.TrimSpace(dto.Name)
		row.Scope = dto.Scope
		if k := strings.TrimSpace(dto.KeyValue); k != "" {
			row.KeyValue = k
		}
		if dto.DailyLimit != nil {
			row.DailyLimit = *dto.DailyLimit
		}
		if dto.Expiry != nil {
			row.Expiry = g5ParseTime(dto.Expiry)
		}
		if dto.Enabled != nil {
			row.Enabled = *dto.Enabled
		}
		if err := db.Save(&row).Error; err != nil {
			response.Fail(c, response.CodeServerError, "failed to update api key")
			return
		}
		response.OK(c, toApiKeyVO(&row))
	})

	e.DELETE("/api-keys/:id", func(c *gin.Context) {
		id, ok := g5ParseID(c)
		if !ok {
			return
		}
		res := db.Where("id = ?", id).Delete(&model.ApiKey{})
		if res.Error != nil {
			response.Fail(c, response.CodeServerError, "failed to delete api key")
			return
		}
		if res.RowsAffected == 0 {
			response.Fail(c, response.CodeNotFound, "api key not found")
			return
		}
		response.OK[any](c, nil)
	})
}
