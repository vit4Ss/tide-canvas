package points

import (
	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
	"tidecanvas/internal/middleware"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
)

// AccountSummary exposes aggregates only: no text models, prompts or request
// details. A single statement keeps totals and the balance on one DB snapshot.
type AccountSummary struct {
	Opening            float64 `json:"opening"`
	Added              float64 `json:"added"`
	Deducted           float64 `json:"deducted"`
	Refunded           float64 `json:"refunded"`
	Total              float64 `json:"total"`
	Reserved           float64 `json:"reserved"`
	Available          float64 `json:"available"`
	PendingTokenPoints float64 `json:"pendingTokenPoints"`
}

func (s *service) accountSummary(userID idgen.ID) (AccountSummary, error) {
	// Cast the numerator BEFORE division: MySQL otherwise rounds an integer
	// division to div_precision_increment places (4 by default), losing micro-
	// points. The real denominator also avoids SQLite integer division; dividing
	// before SUM avoids overflowing its integer accumulator.
	amount := "COALESCE(CAST(amount_micros AS DECIMAL(30,6)) / 1000000.0, amount)"
	totals := s.repo.db.Model(&model.PointRecord{}).Select("user_id, SUM(CASE WHEN "+amount+" > 0 THEN "+amount+" ELSE 0 END) AS added, SUM(CASE WHEN "+amount+" < 0 THEN -("+amount+") ELSE 0 END) AS deducted, SUM(CASE WHEN change_type = 'refund' AND "+amount+" > 0 THEN "+amount+" ELSE 0 END) AS refunded").Where("user_id = ?", userID).Group("user_id")
	account := s.repo.db.Model(&model.User{}).Select("id, points, point_fraction, point_held_micros, chat_pending_micros").Where("id = ?", userID)
	var v AccountSummary
	r := s.repo.db.Table("(?) AS account", account).Select("account.points + CAST(account.point_fraction AS DECIMAL(30,6)) / 1000000.0 AS total, CAST(account.point_held_micros AS DECIMAL(30,6)) / 1000000.0 AS reserved, CAST(account.chat_pending_micros AS DECIMAL(30,6)) / 1000000.0 AS pending_token_points, COALESCE(totals.added, 0) AS added, COALESCE(totals.deducted, 0) AS deducted, COALESCE(totals.refunded, 0) AS refunded").Joins("LEFT JOIN (?) AS totals ON totals.user_id = account.id", totals).Scan(&v)
	if r.Error != nil {
		return v, r.Error
	}
	if r.RowsAffected == 0 {
		return v, ErrNotFound
	}
	v.Available = decimal.NewFromFloat(v.Total).Sub(decimal.NewFromFloat(v.Reserved)).Sub(decimal.NewFromFloat(v.PendingTokenPoints)).InexactFloat64()
	v.Opening = v.Total - v.Added + v.Deducted
	return v, nil
}

func (h *handler) accountSummary(c *gin.Context) {
	v, err := h.svc.accountSummary(middleware.CurrentUserID(c))
	if err != nil {
		h.fail(c, err, "failed to load account totals")
		return
	}
	response.OK(c, v)
}
