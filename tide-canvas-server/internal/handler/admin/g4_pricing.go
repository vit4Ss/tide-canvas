// Package admin owns the admin-console CRUD/list routes mounted under
// /api/admin (the route group is assembled elsewhere with JWTAuth + AdminOnly,
// so every handler here may assume the caller is an admin, role 9).
//
// g4_pricing.go covers the pricing section: subscription plans. Per the LINKAGE
// PRINCIPLE the plan CRUD reads/writes the SAME `plan` table the public
// /pricing page (handler/billing) renders, using the identical Features JSON
// encoding (desc/yearly/cta/featured/items/vipLevel) so an admin edit is
// immediately visible on the front-end pricing cards.
//
// 积分包（point_package）管理已下线（2026-07-08 用户拍板）：积分只随套餐发放，
// 用户端购买通道与后台管理均已移除。point_package 表/种子与 billing 的
// findPackage 保留，仅用于遗留积分包订单的结算与展示。
package admin

import (
	"encoding/json"
	"errors"

	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"

	"tidecanvas/internal/app"
	"tidecanvas/internal/handler/billing"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
)

// RegisterPricing mounts the pricing-admin routes on the (already admin-gated)
// group g.
//
// Routes:
//
//	GET    /plans            -> []g4PlanVO
//	POST   /plans            g4PlanUpsertDTO -> g4PlanVO
//	PUT    /plans/:id        g4PlanUpsertDTO -> g4PlanVO
//	DELETE /plans/:id        -> void
//	GET    /pricing/compare  -> billing.CompareVO（有效值：已存 JSON 或出厂兜底）
//	PUT    /pricing/compare  billing.CompareVO -> billing.CompareVO（存 sys_config）
func RegisterPricing(g *gin.RouterGroup, d *app.Deps) {
	h := &g4PricingHandler{db: d.DB}

	g.GET("/plans", h.listPlans)
	g.POST("/plans", h.createPlan)
	g.PUT("/plans/:id", h.updatePlan)
	g.DELETE("/plans/:id", h.deletePlan)
	// 定价页方案对比表：行内容可编辑；列 = 真实套餐（不落库，随套餐管理走）。
	g.GET("/pricing/compare", h.getCompare)
	g.PUT("/pricing/compare", h.saveCompare)
	// 定价页常见问题 FAQ。
	g.GET("/pricing/faq", h.getFaq)
	g.PUT("/pricing/faq", h.saveFaq)
}

type g4PricingHandler struct {
	db *gorm.DB
}

// ---- VOs ----

// g4PlanVO is the admin plan-row view. It mirrors the public pricing card shape
// ({id,name,monthly,yearly,monthlyPoints,featured,items}) plus the admin-only
// fields (code, desc, cta, sortOrder, status) so the same form round-trips.
type g4PlanVO struct {
	ID            idgen.ID `json:"id"`
	Name          string   `json:"name"`
	Code          string   `json:"code"`
	Desc          string   `json:"desc"`
	Monthly       float64  `json:"monthly"`
	Yearly        float64  `json:"yearly"`
	MonthlyPoints int      `json:"monthlyPoints"`
	Featured      bool     `json:"featured"`
	Cta           string   `json:"cta"`
	Items         []string `json:"items"`
	SortOrder     int      `json:"sortOrder"`
	Status        int      `json:"status"`
	CreateTime    string   `json:"createTime"`
	UpdateTime    string   `json:"updateTime"`
}

// g4PlanFeatures is the JSON shape persisted in model.Plan.Features. It MUST
// match handler/billing's planFeatures so the public pricing page decodes the
// same presentation extras. VipLevel（购买该套餐授予的会员等级，结算时消费）
// 不在管理表单中，但必须在这里声明并在更新时原样保留，否则一次套餐编辑就会
// 把等级映射从 Features 里抹掉。
type g4PlanFeatures struct {
	Desc     string   `json:"desc"`
	Yearly   float64  `json:"yearly"`
	Cta      string   `json:"cta"`
	Featured bool     `json:"featured"`
	Items    []string `json:"items"`
	VipLevel int      `json:"vipLevel"`
}

// ---- DTOs ----

// g4PlanUpsertDTO is the create/update body for a plan. Monthly maps to
// Plan.Price; monthlyPoints to Plan.PointsGrant; the rest are packed into the
// Features JSON blob (same as the public page reads).
// Bounds mirror the DB columns (name varchar(64), code varchar(32), desc
// varchar(512), price decimal(10,2)) so extreme admin input gets a friendly
// 400 instead of a column-constraint 500; prices/points must be non-negative.
type g4PlanUpsertDTO struct {
	Name          string   `json:"name" binding:"required,max=64"`
	Code          string   `json:"code" binding:"required,max=32"`
	Desc          string   `json:"desc" binding:"omitempty,max=512"`
	Monthly       float64  `json:"monthly" binding:"gte=0,lte=99999999.99"`
	Yearly        float64  `json:"yearly" binding:"gte=0,lte=99999999.99"`
	MonthlyPoints int      `json:"monthlyPoints" binding:"gte=0"`
	Featured      bool     `json:"featured"`
	Cta           string   `json:"cta" binding:"omitempty,max=64"`
	Items         []string `json:"items"`
	SortOrder     int      `json:"sortOrder"`
	Status        *int     `json:"status" binding:"omitempty,oneof=0 1"`
}

// ---- plan handlers ----

func (h *g4PricingHandler) listPlans(c *gin.Context) {
	var rows []model.Plan
	if err := h.db.Order("sort_order asc, create_time asc").Find(&rows).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to load plans")
		return
	}
	vos := make([]g4PlanVO, 0, len(rows))
	for i := range rows {
		vos = append(vos, g4ToPlanVO(&rows[i]))
	}
	response.OK(c, vos)
}

func (h *g4PricingHandler) createPlan(c *gin.Context) {
	var dto g4PlanUpsertDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}
	row := model.Plan{}
	g4ApplyPlan(&row, &dto, true)
	// status is force-written: a struct Create would swallow status:0 (下架)
	// via the default:1 tag and put the draft plan straight onto /pricing.
	if err := adminCreateRow(h.db, &row, map[string]any{"status": row.Status}); err != nil {
		if errors.Is(err, gorm.ErrDuplicatedKey) {
			response.Fail(c, response.CodeBadRequest, "套餐编码已存在")
			return
		}
		response.Fail(c, response.CodeServerError, "failed to create plan")
		return
	}
	response.OK(c, g4ToPlanVO(&row))
}

func (h *g4PricingHandler) updatePlan(c *gin.Context) {
	id, ok := g4ParseID(c)
	if !ok {
		return
	}
	var dto g4PlanUpsertDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}
	var row model.Plan
	if err := h.db.First(&row, "id = ?", id).Error; err != nil {
		h.failLookup(c, err, "plan not found", "failed to update plan")
		return
	}
	g4ApplyPlan(&row, &dto, false)
	if err := h.db.Save(&row).Error; err != nil {
		if errors.Is(err, gorm.ErrDuplicatedKey) {
			response.Fail(c, response.CodeBadRequest, "套餐编码已存在")
			return
		}
		response.Fail(c, response.CodeServerError, "failed to update plan")
		return
	}
	// Re-read so the echo carries the persisted values (decimal(10,2) rounding),
	// not the pre-persistence in-memory row.
	if err := h.db.First(&row, "id = ?", id).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to reload plan")
		return
	}
	response.OK(c, g4ToPlanVO(&row))
}

func (h *g4PricingHandler) deletePlan(c *gin.Context) {
	id, ok := g4ParseID(c)
	if !ok {
		return
	}
	res := h.db.Delete(&model.Plan{}, "id = ?", id)
	if res.Error != nil {
		response.Fail(c, response.CodeServerError, "failed to delete plan")
		return
	}
	if res.RowsAffected == 0 {
		response.Fail(c, response.CodeNotFound, "plan not found")
		return
	}
	response.OK[any](c, nil)
}

// ---- compare-table handlers ----

// getCompare returns the effective 方案对比 rows (stored JSON or the factory
// default translated onto live plans) so the admin editor starts pre-filled.
func (h *g4PricingHandler) getCompare(c *gin.Context) {
	vo, err := billing.LoadCompare(h.db)
	if err != nil {
		response.Fail(c, response.CodeServerError, "failed to load compare table")
		return
	}
	response.OK(c, vo)
}

// saveCompare persists the 方案对比 rows to sys_config (pricing.compare) and
// echoes the saved document. Empty-label rows are dropped server-side.
func (h *g4PricingHandler) saveCompare(c *gin.Context) {
	var vo billing.CompareVO
	if err := c.ShouldBindJSON(&vo); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}
	rows := make([]billing.CompareRow, 0, len(vo.Rows))
	for _, r := range vo.Rows {
		if r.Label == "" {
			continue
		}
		if r.Values == nil {
			r.Values = map[string]string{}
		}
		rows = append(rows, r)
	}
	vo.Rows = rows
	if err := billing.SaveCompare(h.db, vo); err != nil {
		response.Fail(c, response.CodeServerError, "failed to save compare table")
		return
	}
	response.OK(c, vo)
}

// getFaq returns the effective 定价 FAQ (stored JSON or factory default).
func (h *g4PricingHandler) getFaq(c *gin.Context) {
	vo, err := billing.LoadFaq(h.db)
	if err != nil {
		response.Fail(c, response.CodeServerError, "failed to load faq")
		return
	}
	response.OK(c, vo)
}

// saveFaq persists the 定价 FAQ to sys_config (pricing.faq). Rows with an
// empty question are dropped server-side.
func (h *g4PricingHandler) saveFaq(c *gin.Context) {
	var vo billing.FaqVO
	if err := c.ShouldBindJSON(&vo); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}
	items := make([]billing.FaqItem, 0, len(vo.Items))
	for _, it := range vo.Items {
		if it.Q == "" {
			continue
		}
		items = append(items, it)
	}
	vo.Items = items
	if err := billing.SaveFaq(h.db, vo); err != nil {
		response.Fail(c, response.CodeServerError, "failed to save faq")
		return
	}
	response.OK(c, vo)
}

// ---- mapping helpers ----

// g4ApplyPlan copies DTO fields onto a plan row. The presentation extras are
// packed into the Features JSON blob in the exact shape the public page reads;
// form 外的既有字段（vipLevel）从旧 Features 原样带过，避免一次编辑抹掉会员
// 等级映射。On create, status defaults to 1 (上架) when omitted; on update an
// omitted status preserves the existing value.
func g4ApplyPlan(row *model.Plan, dto *g4PlanUpsertDTO, create bool) {
	// carry non-form fields forward from the existing blob
	var prev g4PlanFeatures
	if row.Features != "" {
		_ = json.Unmarshal([]byte(row.Features), &prev)
	}

	row.Name = dto.Name
	row.Code = dto.Code
	row.Description = dto.Desc
	row.Price = decimal.NewFromFloat(dto.Monthly)
	row.PointsGrant = dto.MonthlyPoints
	row.SortOrder = dto.SortOrder

	items := dto.Items
	if items == nil {
		items = []string{}
	}
	feat := g4PlanFeatures{
		Desc:     dto.Desc,
		Yearly:   dto.Yearly,
		Cta:      dto.Cta,
		Featured: dto.Featured,
		Items:    items,
		VipLevel: prev.VipLevel,
	}
	if b, err := json.Marshal(feat); err == nil {
		row.Features = string(b)
	}

	if dto.Status != nil {
		row.Status = *dto.Status
	} else if create {
		row.Status = 1
	}
}

func g4ToPlanVO(p *model.Plan) g4PlanVO {
	var f g4PlanFeatures
	if p.Features != "" {
		_ = json.Unmarshal([]byte(p.Features), &f)
	}
	items := f.Items
	if items == nil {
		items = []string{}
	}
	monthly, _ := p.Price.Float64()
	return g4PlanVO{
		ID:            p.ID,
		Name:          p.Name,
		Code:          p.Code,
		Desc:          f.Desc,
		Monthly:       monthly,
		Yearly:        f.Yearly,
		MonthlyPoints: p.PointsGrant,
		Featured:      f.Featured,
		Cta:           f.Cta,
		Items:         items,
		SortOrder:     p.SortOrder,
		Status:        p.Status,
		CreateTime:    g4FormatTime(p.CreateTime),
		UpdateTime:    g4FormatTime(p.UpdateTime),
	}
}

// failLookup maps a gorm lookup error: not-found -> 404, anything else -> 500.
func (h *g4PricingHandler) failLookup(c *gin.Context, err error, notFoundMsg, fallback string) {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		response.Fail(c, response.CodeNotFound, notFoundMsg)
		return
	}
	response.Fail(c, response.CodeServerError, fallback)
}
