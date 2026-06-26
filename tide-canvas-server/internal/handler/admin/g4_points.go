package admin

import (
	"errors"
	"strings"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"tidecanvas/internal/app"
	"tidecanvas/internal/middleware"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/eventlog"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
)

// g4_points.go covers the points section: point-rule CRUD (point_rule table),
// the global point ledger (point_record, all users — read-only), a manual
// balance adjustment that — per the LINKAGE PRINCIPLE — writes BOTH user.Points
// and a point_record ledger row in one transaction so the user's balance and
// the user-facing /api/points/records view stay consistent, and a small config
// section backed by sys_config keys.

// g4PointsConfigKeys are the sys_config keys exposed by the points config
// section. GET returns each key's current value (empty string if unset); PUT
// upserts only the keys present in the body.
var g4PointsConfigKeys = []string{
	"points.checkinDaily", // daily check-in grant
	"points.inviteReward", // invite reward
	"points.signupBonus",  // new-user signup bonus
	"points.exchangeRate", // RMB -> points exchange rate
}

const g4PointsConfigGroup = "points"

// RegisterPoints mounts the points-admin routes on the admin-gated group g.
//
// Routes:
//
//	GET    /points/rules           -> []g4PointRuleVO
//	POST   /points/rules           g4PointRuleUpsertDTO -> g4PointRuleVO
//	PUT    /points/rules/:id       g4PointRuleUpsertDTO -> g4PointRuleVO
//	DELETE /points/rules/:id       -> void
//	GET    /points/transactions    g4PointTxQuery -> PageData<g4PointRecordVO>
//	POST   /points/adjust          g4PointAdjustDTO -> g4PointRecordVO
//	GET    /points/config          -> map[string]string
//	PUT    /points/config          map[string]string -> map[string]string
func RegisterPoints(g *gin.RouterGroup, d *app.Deps) {
	h := &g4PointsHandler{db: d.DB}

	// Rules under the static /points/rules parent.
	g.GET("/points/rules", h.listRules)
	g.POST("/points/rules", h.createRule)
	g.PUT("/points/rules/:id", h.updateRule)
	g.DELETE("/points/rules/:id", h.deleteRule)

	// Ledger (read-only) + manual adjustment + config. All static paths, no
	// :param siblings, so no gin route conflicts.
	g.GET("/points/transactions", h.listTransactions)
	g.POST("/points/adjust", h.adjust)
	g.GET("/points/config", h.getConfig)
	g.PUT("/points/config", h.putConfig)
}

type g4PointsHandler struct {
	db *gorm.DB
}

// ---- VOs ----

// g4PointRuleVO is the admin point-rule row view.
type g4PointRuleVO struct {
	ID         idgen.ID `json:"id"`
	Name       string   `json:"name"`
	Scene      string   `json:"scene"`
	Amount     int      `json:"amount"`
	Trigger    string   `json:"trigger"`
	Enabled    bool     `json:"enabled"`
	CreateTime string   `json:"createTime"`
	UpdateTime string   `json:"updateTime"`
}

// g4PointRecordVO is one ledger row, enriched with the owning user's compact
// block so the admin ledger shows who the entry belongs to.
type g4PointRecordVO struct {
	ID         idgen.ID      `json:"id"`
	UserID     idgen.ID      `json:"userId"`
	User       g4OrderUserVO `json:"user"`
	ChangeType string        `json:"changeType"`
	Amount     int           `json:"amount"`
	Balance    int           `json:"balance"`
	Remark     string        `json:"remark"`
	RefID      *idgen.ID     `json:"refId"`
	CreateTime string        `json:"createTime"`
}

// ---- DTOs ----

// g4PointRuleUpsertDTO is the create/update body for a point rule.
type g4PointRuleUpsertDTO struct {
	Name    string `json:"name" binding:"required"`
	Scene   string `json:"scene" binding:"required"`
	Amount  int    `json:"amount"`
	Trigger string `json:"trigger"`
	Enabled *bool  `json:"enabled"`
}

// g4PointTxQuery is the ledger query: pagination + optional user / changeType
// filters across all users.
type g4PointTxQuery struct {
	g4Page
	UserID     string `form:"userId"`
	ChangeType string `form:"changeType"`
}

// g4PointAdjustDTO is the manual balance-adjustment body. Amount may be negative
// (deduction) or positive (grant).
type g4PointAdjustDTO struct {
	UserID idgen.ID `json:"userId" binding:"required"`
	Amount int      `json:"amount" binding:"required"`
	Remark string   `json:"remark"`
}

// ---- rule handlers ----

func (h *g4PointsHandler) listRules(c *gin.Context) {
	var rows []model.PointRule
	if err := h.db.Order("create_time asc").Find(&rows).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to load rules")
		return
	}
	vos := make([]g4PointRuleVO, 0, len(rows))
	for i := range rows {
		vos = append(vos, g4ToPointRuleVO(&rows[i]))
	}
	response.OK(c, vos)
}

func (h *g4PointsHandler) createRule(c *gin.Context) {
	var dto g4PointRuleUpsertDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}
	row := model.PointRule{}
	g4ApplyRule(&row, &dto, true)
	if err := h.db.Create(&row).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to create rule")
		return
	}
	response.OK(c, g4ToPointRuleVO(&row))
}

func (h *g4PointsHandler) updateRule(c *gin.Context) {
	id, ok := g4ParseID(c)
	if !ok {
		return
	}
	var dto g4PointRuleUpsertDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}
	var row model.PointRule
	if err := h.db.First(&row, "id = ?", id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			response.Fail(c, response.CodeNotFound, "rule not found")
			return
		}
		response.Fail(c, response.CodeServerError, "failed to update rule")
		return
	}
	g4ApplyRule(&row, &dto, false)
	if err := h.db.Save(&row).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to update rule")
		return
	}
	response.OK(c, g4ToPointRuleVO(&row))
}

func (h *g4PointsHandler) deleteRule(c *gin.Context) {
	id, ok := g4ParseID(c)
	if !ok {
		return
	}
	if err := h.db.Delete(&model.PointRule{}, "id = ?", id).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to delete rule")
		return
	}
	response.OK[any](c, nil)
}

// ---- ledger handler ----

func (h *g4PointsHandler) listTransactions(c *gin.Context) {
	var q g4PointTxQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid query: "+err.Error())
		return
	}
	q.normalize()

	tx := h.db.Model(&model.PointRecord{})
	if uid := strings.TrimSpace(q.UserID); uid != "" {
		id, err := idgen.Parse(uid)
		if err != nil {
			response.Fail(c, response.CodeBadRequest, "invalid userId")
			return
		}
		tx = tx.Where("user_id = ?", id)
	}
	if ct := strings.TrimSpace(q.ChangeType); ct != "" {
		tx = tx.Where("change_type = ?", ct)
	}

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to count transactions")
		return
	}

	var rows []model.PointRecord
	if err := tx.Order("create_time desc").
		Limit(q.PageSize).Offset(q.offset()).
		Find(&rows).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to list transactions")
		return
	}

	users := h.loadRecordUsers(rows)
	vos := make([]g4PointRecordVO, 0, len(rows))
	for i := range rows {
		vos = append(vos, g4ToPointRecordVO(&rows[i], users[rows[i].UserID]))
	}
	response.Page(c, vos, total, q.PageNum, q.PageSize)
}

// loadRecordUsers batch-loads the owners for a page of ledger rows.
func (h *g4PointsHandler) loadRecordUsers(rows []model.PointRecord) map[idgen.ID]*model.User {
	out := map[idgen.ID]*model.User{}
	if len(rows) == 0 {
		return out
	}
	idset := map[idgen.ID]struct{}{}
	ids := make([]idgen.ID, 0, len(rows))
	for i := range rows {
		uid := rows[i].UserID
		if _, seen := idset[uid]; !seen {
			idset[uid] = struct{}{}
			ids = append(ids, uid)
		}
	}
	var users []model.User
	if err := h.db.Where("id IN ?", ids).Find(&users).Error; err != nil {
		return out
	}
	for i := range users {
		out[users[i].ID] = &users[i]
	}
	return out
}

// ---- manual adjust handler ----

// adjust applies a manual point delta to a user. It updates user.Points and
// appends a point_record ledger row (changeType "adjust") in a single
// transaction so the balance and the user-facing ledger never diverge. The
// recorded balance is the post-adjustment total.
func (h *g4PointsHandler) adjust(c *gin.Context) {
	var dto g4PointAdjustDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}
	if dto.UserID == 0 {
		response.Fail(c, response.CodeBadRequest, "invalid userId")
		return
	}

	operatorID := middleware.CurrentUserID(c)
	var record model.PointRecord

	err := h.db.Transaction(func(tx *gorm.DB) error {
		var u model.User
		if err := tx.First(&u, "id = ?", dto.UserID).Error; err != nil {
			return err
		}
		newBalance := u.Points + int64(dto.Amount)
		if newBalance < 0 {
			newBalance = 0
		}
		if err := tx.Model(&model.User{}).
			Where("id = ?", dto.UserID).
			Update("points", newBalance).Error; err != nil {
			return err
		}
		remark := strings.TrimSpace(dto.Remark)
		if remark == "" {
			remark = "管理员调整"
		}
		opRef := operatorID
		record = model.PointRecord{
			UserID:     dto.UserID,
			ChangeType: "adjust",
			Amount:     dto.Amount,
			Balance:    int(newBalance),
			Remark:     remark,
			RefID:      &opRef,
		}
		return tx.Create(&record).Error
	})
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			response.Fail(c, response.CodeNotFound, "user not found")
			return
		}
		response.Fail(c, response.CodeServerError, "failed to adjust points")
		return
	}

	eventlog.Biz(&model.BizLog{
		UserID:     dto.UserID,
		Action:     "points_adjust",
		Summary:    "管理员调整积分",
		Points:     int64(dto.Amount),
		RefID:      record.ID,
		RefType:    "point_record",
		OperatorID: operatorID,
		Detail:     eventlog.Truncate(strings.TrimSpace(dto.Remark), 1024),
	})

	var u model.User
	var up *model.User
	if e := h.db.First(&u, "id = ?", dto.UserID).Error; e == nil {
		up = &u
	}
	response.OK(c, g4ToPointRecordVO(&record, up))
}

// ---- config handlers ----

func (h *g4PointsHandler) getConfig(c *gin.Context) {
	var rows []model.SysConfig
	if err := h.db.Where("config_key IN ?", g4PointsConfigKeys).Find(&rows).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to load config")
		return
	}
	out := map[string]string{}
	for _, k := range g4PointsConfigKeys {
		out[k] = ""
	}
	for i := range rows {
		out[rows[i].ConfigKey] = rows[i].ConfigValue
	}
	response.OK(c, out)
}

func (h *g4PointsHandler) putConfig(c *gin.Context) {
	var body map[string]string
	if err := c.ShouldBindJSON(&body); err != nil {
		response.Fail(c, response.CodeBadRequest, "invalid request: "+err.Error())
		return
	}
	allowed := map[string]struct{}{}
	for _, k := range g4PointsConfigKeys {
		allowed[k] = struct{}{}
	}

	err := h.db.Transaction(func(tx *gorm.DB) error {
		for key, val := range body {
			if _, ok := allowed[key]; !ok {
				continue // ignore unknown keys
			}
			var row model.SysConfig
			err := tx.Where("config_key = ?", key).First(&row).Error
			switch {
			case err == nil:
				row.ConfigValue = val
				row.Group = g4PointsConfigGroup
				if err := tx.Save(&row).Error; err != nil {
					return err
				}
			case errors.Is(err, gorm.ErrRecordNotFound):
				row = model.SysConfig{
					ConfigKey:   key,
					ConfigValue: val,
					Group:       g4PointsConfigGroup,
				}
				if err := tx.Create(&row).Error; err != nil {
					return err
				}
			default:
				return err
			}
		}
		return nil
	})
	if err != nil {
		response.Fail(c, response.CodeServerError, "failed to save config")
		return
	}

	// Echo back the full, current config set.
	h.getConfig(c)
}

// ---- mapping helpers ----

// g4ApplyRule copies DTO fields onto a point-rule row. On create, enabled
// defaults to true when omitted; on update an omitted enabled preserves it.
func g4ApplyRule(row *model.PointRule, dto *g4PointRuleUpsertDTO, create bool) {
	row.Name = dto.Name
	row.Scene = dto.Scene
	row.Amount = dto.Amount
	row.Trigger = dto.Trigger
	if dto.Enabled != nil {
		row.Enabled = *dto.Enabled
	} else if create {
		row.Enabled = true
	}
}

func g4ToPointRuleVO(p *model.PointRule) g4PointRuleVO {
	return g4PointRuleVO{
		ID:         p.ID,
		Name:       p.Name,
		Scene:      p.Scene,
		Amount:     p.Amount,
		Trigger:    p.Trigger,
		Enabled:    p.Enabled,
		CreateTime: g4FormatTime(p.CreateTime),
		UpdateTime: g4FormatTime(p.UpdateTime),
	}
}

func g4ToPointRecordVO(r *model.PointRecord, u *model.User) g4PointRecordVO {
	vo := g4PointRecordVO{
		ID:         r.ID,
		UserID:     r.UserID,
		ChangeType: r.ChangeType,
		Amount:     r.Amount,
		Balance:    r.Balance,
		Remark:     r.Remark,
		RefID:      r.RefID,
		CreateTime: g4FormatTime(r.CreateTime),
	}
	if u != nil {
		vo.User = g4OrderUserVO{
			ID:       u.ID,
			Username: u.Username,
			Nickname: u.Nickname,
			Avatar:   u.Avatar,
		}
	} else {
		vo.User = g4OrderUserVO{ID: r.UserID}
	}
	return vo
}
