package admin

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"tidecanvas/internal/app"
	"tidecanvas/internal/middleware"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/activationcode"
	"tidecanvas/internal/pkg/eventlog"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
)

const maxActivationCodeBatchSize = 200

// RegisterActivationCodes mounts activation-code administration behind the
// admin.activation_codes permission group.
func RegisterActivationCodes(g *gin.RouterGroup, d *app.Deps) {
	h := &g4ActivationCodeHandler{db: d.DB}
	g.GET("/activation-codes/summary", h.summary)
	g.GET("/activation-codes", h.listCodes)
	g.POST("/activation-codes/generate", h.generate)
	g.PUT("/activation-codes/:id/status", h.updateStatus)
	g.GET("/activation-code-claims", h.listClaims)
}

type g4ActivationCodeHandler struct{ db *gorm.DB }

type g4ActivationCodeQuery struct {
	g4Page
	Keyword string `form:"keyword"`
	State   string `form:"state"`
}

type g4ActivationClaimQuery struct {
	g4Page
	Keyword          string   `form:"keyword"`
	ActivationCodeID idgen.ID `form:"activationCodeId"`
}

type g4ActivationCodeGenerateDTO struct {
	BatchName  string    `json:"batchName" binding:"max=64"`
	Quantity   int       `json:"quantity" binding:"required,min=1,max=200"`
	UsageLimit int       `json:"usageLimit" binding:"required,min=1,max=100000"`
	Points     int       `json:"points" binding:"required,min=1,max=1000000"`
	ExpiresAt  time.Time `json:"expiresAt" binding:"required"`
}

type g4ActivationCodeStatusDTO struct {
	Enabled *bool `json:"enabled" binding:"required"`
}

type g4ActivationCodeVO struct {
	ID         idgen.ID `json:"id"`
	CodeHint   string   `json:"codeHint"`
	BatchName  string   `json:"batchName"`
	Points     int      `json:"points"`
	UsageLimit int      `json:"usageLimit"`
	UsedCount  int      `json:"usedCount"`
	Enabled    bool     `json:"enabled"`
	State      string   `json:"state"`
	ExpiresAt  string   `json:"expiresAt"`
	LastUsedAt string   `json:"lastUsedAt"`
	CreatedBy  idgen.ID `json:"createdBy"`
	CreateTime string   `json:"createTime"`
}

type g4ActivationCodeGenerateVO struct {
	BatchName string   `json:"batchName"`
	Quantity  int      `json:"quantity"`
	Codes     []string `json:"codes"`
}

type g4ActivationCodeSummaryVO struct {
	TotalCodes   int64 `json:"totalCodes"`
	Available    int64 `json:"available"`
	Claims       int64 `json:"claims"`
	PointsIssued int64 `json:"pointsIssued"`
}

type g4ActivationClaimVO struct {
	ID               idgen.ID      `json:"id"`
	ActivationCodeID idgen.ID      `json:"activationCodeId"`
	CodeHint         string        `json:"codeHint"`
	BatchName        string        `json:"batchName"`
	UserID           idgen.ID      `json:"userId"`
	User             g4OrderUserVO `json:"user"`
	Points           int           `json:"points"`
	Balance          int           `json:"balance"`
	ClientIP         string        `json:"clientIp"`
	CreateTime       string        `json:"createTime"`
}

func activationState(row *model.ActivationCode, now time.Time) string {
	switch {
	case row.Status != 1:
		return "disabled"
	case !row.ExpiresAt.After(now):
		return "expired"
	case row.UsedCount >= row.UsageLimit:
		return "exhausted"
	default:
		return "available"
	}
}

func activationCodeVO(row *model.ActivationCode, now time.Time) g4ActivationCodeVO {
	vo := g4ActivationCodeVO{
		ID: row.ID, CodeHint: row.CodeHint, BatchName: row.BatchName,
		Points: row.Points, UsageLimit: row.UsageLimit, UsedCount: row.UsedCount,
		Enabled: row.Status == 1, State: activationState(row, now),
		ExpiresAt: g4FormatTime(row.ExpiresAt), CreatedBy: row.CreatedBy,
		CreateTime: g4FormatTime(row.CreateTime),
	}
	if row.LastUsedAt != nil {
		vo.LastUsedAt = g4FormatTime(*row.LastUsedAt)
	}
	return vo
}

func (h *g4ActivationCodeHandler) listCodes(c *gin.Context) {
	var q g4ActivationCodeQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		response.Fail(c, response.CodeBadRequest, "查询参数不正确")
		return
	}
	q.normalize()
	now := time.Now()
	tx := h.db.Model(&model.ActivationCode{})
	if kw := strings.TrimSpace(q.Keyword); kw != "" {
		like := "%" + kw + "%"
		tx = tx.Where("batch_name LIKE ? OR code_hint LIKE ?", like, like)
	}
	switch strings.TrimSpace(q.State) {
	case "":
	case "available":
		tx = tx.Where("status = 1 AND expires_at > ? AND used_count < usage_limit", now)
	case "disabled":
		tx = tx.Where("status <> 1")
	case "expired":
		tx = tx.Where("status = 1 AND expires_at <= ?", now)
	case "exhausted":
		tx = tx.Where("status = 1 AND expires_at > ? AND used_count >= usage_limit", now)
	default:
		response.Fail(c, response.CodeBadRequest, "激活码状态不正确")
		return
	}
	var total int64
	if err := tx.Count(&total).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to count activation codes")
		return
	}
	var rows []model.ActivationCode
	if err := tx.Order("create_time DESC").Limit(q.PageSize).Offset(q.offset()).Find(&rows).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to list activation codes")
		return
	}
	vos := make([]g4ActivationCodeVO, 0, len(rows))
	for i := range rows {
		vos = append(vos, activationCodeVO(&rows[i], now))
	}
	response.Page(c, vos, total, q.PageNum, q.PageSize)
}

func (h *g4ActivationCodeHandler) summary(c *gin.Context) {
	now := time.Now()
	var vo g4ActivationCodeSummaryVO
	if err := h.db.Model(&model.ActivationCode{}).Count(&vo.TotalCodes).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to summarize activation codes")
		return
	}
	if err := h.db.Model(&model.ActivationCode{}).
		Where("status = 1 AND expires_at > ? AND used_count < usage_limit", now).
		Count(&vo.Available).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to summarize activation codes")
		return
	}
	type claimTotals struct {
		Claims int64
		Points int64
	}
	var totals claimTotals
	if err := h.db.Model(&model.ActivationCodeClaim{}).
		Select("COUNT(*) AS claims, COALESCE(SUM(points), 0) AS points").Scan(&totals).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to summarize activation claims")
		return
	}
	vo.Claims, vo.PointsIssued = totals.Claims, totals.Points
	response.OK(c, vo)
}

func (h *g4ActivationCodeHandler) generate(c *gin.Context) {
	var dto g4ActivationCodeGenerateDTO
	if err := c.ShouldBindJSON(&dto); err != nil {
		response.Fail(c, response.CodeBadRequest, "请完整填写生成数量、使用次数、积分和到期时间")
		return
	}
	now := time.Now()
	if !dto.ExpiresAt.After(now) {
		response.Fail(c, response.CodeBadRequest, "到期时间必须晚于当前时间")
		return
	}
	if dto.Quantity > maxActivationCodeBatchSize {
		response.Fail(c, response.CodeBadRequest, "单次最多生成 200 个激活码")
		return
	}
	batchName := strings.TrimSpace(dto.BatchName)
	if batchName == "" {
		batchName = "激活码批次 " + now.Format("2006-01-02 15:04")
	}
	operatorID := middleware.CurrentUserID(c)
	plains := make([]string, 0, dto.Quantity)
	err := h.db.Transaction(func(tx *gorm.DB) error {
		for len(plains) < dto.Quantity {
			created := false
			for attempt := 0; attempt < 5; attempt++ {
				plain, err := activationcode.Generate()
				if err != nil {
					return err
				}
				hash, _ := activationcode.Hash(plain)
				hint, _ := activationcode.Hint(plain)
				row := model.ActivationCode{
					CodeHash: hash, CodeHint: hint, BatchName: batchName,
					Points: dto.Points, UsageLimit: dto.UsageLimit, Status: 1,
					ExpiresAt: dto.ExpiresAt, CreatedBy: operatorID,
				}
				if err := tx.Create(&row).Error; err != nil {
					if errors.Is(err, gorm.ErrDuplicatedKey) {
						continue
					}
					return err
				}
				plains = append(plains, plain)
				created = true
				break
			}
			if !created {
				return errors.New("activation code collision retry exhausted")
			}
		}
		return nil
	})
	if err != nil {
		response.Fail(c, response.CodeServerError, "failed to generate activation codes")
		return
	}
	eventlog.Biz(&model.BizLog{
		Action: "activation_code_generate", Summary: "生成激活码",
		OperatorID: operatorID, RefType: "activation_code_batch",
		Detail: fmt.Sprintf("批次=%s; 数量=%d; 单码积分=%d; 单码次数=%d", batchName, dto.Quantity, dto.Points, dto.UsageLimit),
	})
	response.OK(c, g4ActivationCodeGenerateVO{BatchName: batchName, Quantity: len(plains), Codes: plains})
}

func (h *g4ActivationCodeHandler) updateStatus(c *gin.Context) {
	id, ok := g4ParseID(c)
	if !ok {
		return
	}
	var dto g4ActivationCodeStatusDTO
	if err := c.ShouldBindJSON(&dto); err != nil || dto.Enabled == nil {
		response.Fail(c, response.CodeBadRequest, "请指定启用状态")
		return
	}
	status := 0
	if *dto.Enabled {
		status = 1
	}
	res := h.db.Model(&model.ActivationCode{}).Where("id = ?", id).Update("status", status)
	if res.Error != nil {
		response.Fail(c, response.CodeServerError, "failed to update activation code")
		return
	}
	if res.RowsAffected == 0 {
		response.Fail(c, response.CodeNotFound, "激活码不存在")
		return
	}
	var row model.ActivationCode
	if err := h.db.First(&row, "id = ?", id).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to load activation code")
		return
	}
	eventlog.Biz(&model.BizLog{
		Action: "activation_code_status", Summary: "更新激活码状态",
		OperatorID: middleware.CurrentUserID(c), RefID: id, RefType: "activation_code",
		Detail: fmt.Sprintf("状态=%t; 标识=%s", *dto.Enabled, row.CodeHint),
	})
	response.OK(c, activationCodeVO(&row, time.Now()))
}

func (h *g4ActivationCodeHandler) listClaims(c *gin.Context) {
	var q g4ActivationClaimQuery
	if err := c.ShouldBindQuery(&q); err != nil {
		response.Fail(c, response.CodeBadRequest, "查询参数不正确")
		return
	}
	q.normalize()
	tx := h.db.Model(&model.ActivationCodeClaim{})
	if q.ActivationCodeID != 0 {
		tx = tx.Where("activation_code_id = ?", q.ActivationCodeID)
	}
	if kw := strings.TrimSpace(q.Keyword); kw != "" {
		like := "%" + kw + "%"
		var userIDs []idgen.ID
		_ = h.db.Model(&model.User{}).
			Where("username LIKE ? OR nickname LIKE ? OR email LIKE ?", like, like, like).
			Limit(500).Pluck("id", &userIDs).Error
		where := h.db.Where("batch_name LIKE ? OR code_hint LIKE ?", like, like)
		if parsed, err := idgen.Parse(kw); err == nil && parsed != 0 {
			userIDs = append(userIDs, parsed)
		}
		if len(userIDs) > 0 {
			where = where.Or("user_id IN ?", userIDs)
		}
		tx = tx.Where(where)
	}
	var total int64
	if err := tx.Count(&total).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to count activation claims")
		return
	}
	var rows []model.ActivationCodeClaim
	if err := tx.Order("create_time DESC").Limit(q.PageSize).Offset(q.offset()).Find(&rows).Error; err != nil {
		response.Fail(c, response.CodeServerError, "failed to list activation claims")
		return
	}
	users := h.loadClaimUsers(rows)
	vos := make([]g4ActivationClaimVO, 0, len(rows))
	for i := range rows {
		r := &rows[i]
		vo := g4ActivationClaimVO{
			ID: r.ID, ActivationCodeID: r.ActivationCodeID,
			CodeHint: r.CodeHint, BatchName: r.BatchName,
			UserID: r.UserID, Points: r.Points, Balance: r.Balance,
			ClientIP: r.ClientIP, CreateTime: g4FormatTime(r.CreateTime),
		}
		if u := users[r.UserID]; u != nil {
			vo.User = g4OrderUserVO{ID: u.ID, Username: u.Username, Nickname: u.Nickname, Avatar: u.Avatar}
		} else {
			vo.User = g4OrderUserVO{ID: r.UserID}
		}
		vos = append(vos, vo)
	}
	response.Page(c, vos, total, q.PageNum, q.PageSize)
}

func (h *g4ActivationCodeHandler) loadClaimUsers(rows []model.ActivationCodeClaim) map[idgen.ID]*model.User {
	out := map[idgen.ID]*model.User{}
	ids := make([]idgen.ID, 0, len(rows))
	seen := make(map[idgen.ID]struct{}, len(rows))
	for i := range rows {
		if _, ok := seen[rows[i].UserID]; ok {
			continue
		}
		seen[rows[i].UserID] = struct{}{}
		ids = append(ids, rows[i].UserID)
	}
	if len(ids) == 0 {
		return out
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
