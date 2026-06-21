package points

import (
	"time"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

// vo.go defines response payloads for the points endpoints. Every id field is
// an idgen.ID (serialized as a quoted decimal string); all JSON is camelCase.

// BalanceVO is the response of GET /api/points/balance. points is the user's
// current usable balance (User.Points); frozen is reserved/held points. The
// User model has no frozen column, so it is derived as 0 in the VO.
type BalanceVO struct {
	Points int64 `json:"points"`
	Frozen int64 `json:"frozen"`
}

// PointRecordVO is one row of the points ledger (GET /api/points/records).
// RefID is a pointer so it serializes as null when the record has no origin.
type PointRecordVO struct {
	ID         idgen.ID  `json:"id"`
	ChangeType string    `json:"changeType"`
	Amount     int       `json:"amount"`
	Balance    int       `json:"balance"`
	Remark     string    `json:"remark"`
	RefID      *idgen.ID `json:"refId"`
	CreateTime string    `json:"createTime"`
}

// CheckinStatusVO is the response of GET /api/points/checkin: whether the user
// has already checked in today and their current streak length.
type CheckinStatusVO struct {
	CheckedToday   bool `json:"checkedToday"`
	ContinuousDays int  `json:"continuousDays"`
}

// CheckinResultVO is the response of POST /api/points/checkin: the points
// awarded for the check-in, the resulting streak length, and whether this call
// actually rewarded the user (false when already checked in today — idempotent).
type CheckinResultVO struct {
	Points         int  `json:"points"`
	ContinuousDays int  `json:"continuousDays"`
	Rewarded       bool `json:"rewarded"`
}

// toPointRecordVO maps a persisted ledger row to its VO.
func toPointRecordVO(r *model.PointRecord) PointRecordVO {
	return PointRecordVO{
		ID:         r.ID,
		ChangeType: r.ChangeType,
		Amount:     r.Amount,
		Balance:    r.Balance,
		Remark:     r.Remark,
		RefID:      r.RefID,
		CreateTime: formatTime(r.CreateTime),
	}
}

// formatTime renders a time as RFC3339, or "" for the zero value.
func formatTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.Format(time.RFC3339)
}
