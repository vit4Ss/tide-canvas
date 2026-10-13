package points

import (
	"github.com/gin-gonic/gin"
	"tidecanvas/internal/middleware"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
)

// AccountSummary exposes aggregates only: no text models, prompts or request
// details. A single statement keeps totals and the balance on one DB snapshot.
type AccountSummary struct {
	Opening   float64 `json:"opening"`
	Added     float64 `json:"added"`
	Deducted  float64 `json:"deducted"`
	Refunded  float64 `json:"refunded"`
	Total     float64 `json:"total"`
	Reserved  float64 `json:"reserved"`
	Available float64 `json:"available"`
}

func (s *service) accountSummary(userID idgen.ID) (AccountSummary, error) {
	// Division before SUM avoids integer overflow in SQLite's accumulator;
	// MySQL evaluates the expression with decimal precision.
	amount := "COALESCE(amount_micros / 1000000.0, amount)"
	totals := s.repo.db.Model(&model.PointRecord{}).Select("user_id, SUM(CASE WHEN "+amount+" > 0 THEN "+amount+" ELSE 0 END) AS added, SUM(CASE WHEN "+amount+" < 0 THEN -("+amount+") ELSE 0 END) AS deducted, SUM(CASE WHEN change_type = 'refund' AND "+amount+" > 0 THEN "+amount+" ELSE 0 END) AS refunded").Where("user_id = ?", userID).Group("user_id")
	account := s.repo.db.Model(&model.User{}).Select("id, points, point_fraction, point_held_micros").Where("id = ?", userID)
	var v AccountSummary
	r := s.repo.db.Table("(?) AS account", account).Select("account.points + account.point_fraction / 1000000.0 AS total, account.point_held_micros / 1000000.0 AS reserved, COALESCE(totals.added, 0) AS added, COALESCE(totals.deducted, 0) AS deducted, COALESCE(totals.refunded, 0) AS refunded").Joins("LEFT JOIN (?) AS totals ON totals.user_id = account.id", totals).Scan(&v)
	if r.Error != nil {
		return v, r.Error
	}
	if r.RowsAffected == 0 {
		return v, ErrNotFound
	}
	v.Available = v.Total - v.Reserved
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
