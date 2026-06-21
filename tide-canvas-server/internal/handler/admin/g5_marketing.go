package admin

import (
	"errors"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"

	"tidecanvas/internal/app"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
)

// g5_marketing.go: admin marketing routes — campaigns (model.Campaign) and
// coupons (model.Coupon). Full CRUD on the campaign / coupon tables.

// ---- Campaign VO / DTO ----

// CampaignVO is the list/detail view of a marketing campaign. JSON keys are
// camelCase; times are RFC3339 strings (empty when zero).
type CampaignVO struct {
	ID        idgen.ID `json:"id"`
	Name      string   `json:"name"`
	Type      string   `json:"type"`
	Strength  string   `json:"strength"`
	StartTime string   `json:"startTime"`
	EndTime   string   `json:"endTime"`
	Used      int      `json:"used"`
	Limit     int      `json:"limit"`
	Status    string   `json:"status"`
	Audience  string   `json:"audience"`
	Channels  string   `json:"channels"`
}

func toCampaignVO(m *model.Campaign) CampaignVO {
	return CampaignVO{
		ID:        m.ID,
		Name:      m.Name,
		Type:      m.Type,
		Strength:  m.Strength,
		StartTime: g5FmtTime(m.StartTime),
		EndTime:   g5FmtTime(m.EndTime),
		Used:      m.Used,
		Limit:     m.Limit,
		Status:    m.Status,
		Audience:  m.Audience,
		Channels:  m.Channels,
	}
}

// CampaignDTO is the create/update body for a campaign.
type CampaignDTO struct {
	Name      string  `json:"name" binding:"required,max=128"`
	Type      string  `json:"type" binding:"required,max=32"`
	Strength  string  `json:"strength"`
	StartTime *string `json:"startTime"`
	EndTime   *string `json:"endTime"`
	Used      *int    `json:"used"`
	Limit     *int    `json:"limit"`
	Status    string  `json:"status"`
	Audience  string  `json:"audience"`
	Channels  string  `json:"channels"`
}

// ---- Coupon VO / DTO ----

// CouponVO is the list/detail view of a coupon.
type CouponVO struct {
	ID        idgen.ID `json:"id"`
	Code      string   `json:"code"`
	Type      string   `json:"type"`
	Value     string   `json:"value"`
	StartTime string   `json:"startTime"`
	EndTime   string   `json:"endTime"`
	Used      int      `json:"used"`
	Limit     int      `json:"limit"`
	Status    string   `json:"status"`
}

func toCouponVO(m *model.Coupon) CouponVO {
	return CouponVO{
		ID:        m.ID,
		Code:      m.Code,
		Type:      m.Type,
		Value:     m.Value.String(),
		StartTime: g5FmtTime(m.StartTime),
		EndTime:   g5FmtTime(m.EndTime),
		Used:      m.Used,
		Limit:     m.Limit,
		Status:    m.Status,
	}
}

// CouponDTO is the create/update body for a coupon.
type CouponDTO struct {
	Code      string  `json:"code" binding:"required,max=64"`
	Type      string  `json:"type" binding:"required,max=16"`
	Value     *string `json:"value"`
	StartTime *string `json:"startTime"`
	EndTime   *string `json:"endTime"`
	Used      *int    `json:"used"`
	Limit     *int    `json:"limit"`
	Status    string  `json:"status"`
}

// RegisterMarketing mounts the marketing admin routes on the admin group.
//
//	GET    /marketing/campaigns        g5PageQuery -> PageData<CampaignVO>
//	POST   /marketing/campaigns        CampaignDTO -> CampaignVO
//	PUT    /marketing/campaigns/:id    CampaignDTO -> CampaignVO
//	DELETE /marketing/campaigns/:id    -> void
//	GET    /marketing/coupons          g5PageQuery -> PageData<CouponVO>
//	POST   /marketing/coupons          CouponDTO -> CouponVO
//	PUT    /marketing/coupons/:id      CouponDTO -> CouponVO
//	DELETE /marketing/coupons/:id      -> void
func RegisterMarketing(g *gin.RouterGroup, d *app.Deps) {
	db := d.DB

	m := g.Group("/marketing")

	// Campaigns.
	m.GET("/campaigns", func(c *gin.Context) {
		var q g5PageQuery
		if err := c.ShouldBindQuery(&q); err != nil {
			response.Fail(c, response.CodeBadRequest, "invalid query: "+err.Error())
			return
		}
		q.normalize()

		tx := db.Model(&model.Campaign{})
		if q.Keyword != "" {
			tx = tx.Where("name LIKE ?", "%"+q.Keyword+"%")
		}
		if q.Status != "" {
			tx = tx.Where("status = ?", q.Status)
		}
		if q.Type != "" {
			tx = tx.Where("type = ?", q.Type)
		}

		var total int64
		if err := tx.Count(&total).Error; err != nil {
			response.Fail(c, response.CodeServerError, "failed to count campaigns")
			return
		}
		var rows []model.Campaign
		if err := tx.Order("create_time DESC").Limit(q.PageSize).Offset(q.offset()).Find(&rows).Error; err != nil {
			response.Fail(c, response.CodeServerError, "failed to list campaigns")
			return
		}
		vos := make([]CampaignVO, 0, len(rows))
		for i := range rows {
			vos = append(vos, toCampaignVO(&rows[i]))
		}
		response.Page(c, vos, total, q.PageNum, q.PageSize)
	})

	m.POST("/campaigns", func(c *gin.Context) {
		var dto CampaignDTO
		if err := c.ShouldBindJSON(&dto); err != nil {
			response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
			return
		}
		row := model.Campaign{
			Name:     strings.TrimSpace(dto.Name),
			Type:     strings.TrimSpace(dto.Type),
			Strength: dto.Strength,
			Status:   g5Default(dto.Status, "draft"),
			Audience: dto.Audience,
			Channels: dto.Channels,
		}
		row.StartTime = g5ParseTime(dto.StartTime)
		row.EndTime = g5ParseTime(dto.EndTime)
		if dto.Used != nil {
			row.Used = *dto.Used
		}
		if dto.Limit != nil {
			row.Limit = *dto.Limit
		}
		if err := db.Create(&row).Error; err != nil {
			response.Fail(c, response.CodeServerError, "failed to create campaign")
			return
		}
		response.OK(c, toCampaignVO(&row))
	})

	m.PUT("/campaigns/:id", func(c *gin.Context) {
		id, ok := g5ParseID(c)
		if !ok {
			return
		}
		var dto CampaignDTO
		if err := c.ShouldBindJSON(&dto); err != nil {
			response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
			return
		}
		var row model.Campaign
		if err := db.First(&row, "id = ?", id).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				response.Fail(c, response.CodeNotFound, "campaign not found")
				return
			}
			response.Fail(c, response.CodeServerError, "failed to load campaign")
			return
		}
		row.Name = strings.TrimSpace(dto.Name)
		row.Type = strings.TrimSpace(dto.Type)
		row.Strength = dto.Strength
		row.Audience = dto.Audience
		row.Channels = dto.Channels
		if dto.Status != "" {
			row.Status = dto.Status
		}
		if dto.StartTime != nil {
			row.StartTime = g5ParseTime(dto.StartTime)
		}
		if dto.EndTime != nil {
			row.EndTime = g5ParseTime(dto.EndTime)
		}
		if dto.Used != nil {
			row.Used = *dto.Used
		}
		if dto.Limit != nil {
			row.Limit = *dto.Limit
		}
		if err := db.Save(&row).Error; err != nil {
			response.Fail(c, response.CodeServerError, "failed to update campaign")
			return
		}
		response.OK(c, toCampaignVO(&row))
	})

	m.DELETE("/campaigns/:id", func(c *gin.Context) {
		id, ok := g5ParseID(c)
		if !ok {
			return
		}
		res := db.Where("id = ?", id).Delete(&model.Campaign{})
		if res.Error != nil {
			response.Fail(c, response.CodeServerError, "failed to delete campaign")
			return
		}
		if res.RowsAffected == 0 {
			response.Fail(c, response.CodeNotFound, "campaign not found")
			return
		}
		response.OK[any](c, nil)
	})

	// Coupons.
	m.GET("/coupons", func(c *gin.Context) {
		var q g5PageQuery
		if err := c.ShouldBindQuery(&q); err != nil {
			response.Fail(c, response.CodeBadRequest, "invalid query: "+err.Error())
			return
		}
		q.normalize()

		tx := db.Model(&model.Coupon{})
		if q.Keyword != "" {
			tx = tx.Where("code LIKE ?", "%"+q.Keyword+"%")
		}
		if q.Status != "" {
			tx = tx.Where("status = ?", q.Status)
		}
		if q.Type != "" {
			tx = tx.Where("type = ?", q.Type)
		}

		var total int64
		if err := tx.Count(&total).Error; err != nil {
			response.Fail(c, response.CodeServerError, "failed to count coupons")
			return
		}
		var rows []model.Coupon
		if err := tx.Order("create_time DESC").Limit(q.PageSize).Offset(q.offset()).Find(&rows).Error; err != nil {
			response.Fail(c, response.CodeServerError, "failed to list coupons")
			return
		}
		vos := make([]CouponVO, 0, len(rows))
		for i := range rows {
			vos = append(vos, toCouponVO(&rows[i]))
		}
		response.Page(c, vos, total, q.PageNum, q.PageSize)
	})

	m.POST("/coupons", func(c *gin.Context) {
		var dto CouponDTO
		if err := c.ShouldBindJSON(&dto); err != nil {
			response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
			return
		}
		row := model.Coupon{
			Code:   strings.TrimSpace(dto.Code),
			Type:   strings.TrimSpace(dto.Type),
			Value:  g5ParseDecimal(dto.Value),
			Status: g5Default(dto.Status, "active"),
		}
		row.StartTime = g5ParseTime(dto.StartTime)
		row.EndTime = g5ParseTime(dto.EndTime)
		if dto.Used != nil {
			row.Used = *dto.Used
		}
		if dto.Limit != nil {
			row.Limit = *dto.Limit
		}
		if err := db.Create(&row).Error; err != nil {
			response.Fail(c, response.CodeServerError, "failed to create coupon")
			return
		}
		response.OK(c, toCouponVO(&row))
	})

	m.PUT("/coupons/:id", func(c *gin.Context) {
		id, ok := g5ParseID(c)
		if !ok {
			return
		}
		var dto CouponDTO
		if err := c.ShouldBindJSON(&dto); err != nil {
			response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
			return
		}
		var row model.Coupon
		if err := db.First(&row, "id = ?", id).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				response.Fail(c, response.CodeNotFound, "coupon not found")
				return
			}
			response.Fail(c, response.CodeServerError, "failed to load coupon")
			return
		}
		row.Code = strings.TrimSpace(dto.Code)
		row.Type = strings.TrimSpace(dto.Type)
		if dto.Value != nil {
			row.Value = g5ParseDecimal(dto.Value)
		}
		if dto.Status != "" {
			row.Status = dto.Status
		}
		if dto.StartTime != nil {
			row.StartTime = g5ParseTime(dto.StartTime)
		}
		if dto.EndTime != nil {
			row.EndTime = g5ParseTime(dto.EndTime)
		}
		if dto.Used != nil {
			row.Used = *dto.Used
		}
		if dto.Limit != nil {
			row.Limit = *dto.Limit
		}
		if err := db.Save(&row).Error; err != nil {
			response.Fail(c, response.CodeServerError, "failed to update coupon")
			return
		}
		response.OK(c, toCouponVO(&row))
	})

	m.DELETE("/coupons/:id", func(c *gin.Context) {
		id, ok := g5ParseID(c)
		if !ok {
			return
		}
		res := db.Where("id = ?", id).Delete(&model.Coupon{})
		if res.Error != nil {
			response.Fail(c, response.CodeServerError, "failed to delete coupon")
			return
		}
		if res.RowsAffected == 0 {
			response.Fail(c, response.CodeNotFound, "coupon not found")
			return
		}
		response.OK[any](c, nil)
	})
}

// ---- shared time / decimal / default helpers (g5) ----

// g5FmtTime renders a time as RFC3339, or "" when zero.
func g5FmtTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.Format(time.RFC3339)
}

// g5ParseTime parses an optional RFC3339 / common datetime string into a
// time.Time, returning the zero time on nil/empty/unparseable input.
func g5ParseTime(s *string) time.Time {
	if s == nil {
		return time.Time{}
	}
	v := strings.TrimSpace(*s)
	if v == "" {
		return time.Time{}
	}
	for _, layout := range []string{time.RFC3339, "2006-01-02T15:04:05", "2006-01-02 15:04:05", "2006-01-02"} {
		if t, err := time.Parse(layout, v); err == nil {
			return t
		}
	}
	return time.Time{}
}

// g5ParseDecimal parses an optional decimal string, returning zero on nil/empty
// or unparseable input.
func g5ParseDecimal(s *string) decimal.Decimal {
	if s == nil {
		return decimal.Zero
	}
	v := strings.TrimSpace(*s)
	if v == "" {
		return decimal.Zero
	}
	d, err := decimal.NewFromString(v)
	if err != nil {
		return decimal.Zero
	}
	return d
}

// g5Default returns v when non-empty, otherwise def.
func g5Default(v, def string) string {
	if strings.TrimSpace(v) == "" {
		return def
	}
	return v
}
