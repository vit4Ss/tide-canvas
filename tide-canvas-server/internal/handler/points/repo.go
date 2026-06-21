package points

import (
	"errors"
	"strings"

	"gorm.io/gorm"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

// repo.go is the points domain's persistence layer over *gorm.DB.

// ErrNotFound is returned when a lookup yields no row.
var ErrNotFound = errors.New("points: not found")

type repo struct {
	db *gorm.DB
}

func newRepo(db *gorm.DB) *repo { return &repo{db: db} }

// userPoints returns the current points balance for a user from the users
// table. Returns ErrNotFound when the user does not exist.
func (r *repo) userPoints(userID idgen.ID) (int64, error) {
	var u model.User
	err := r.db.Select("id", "points").Where("id = ?", userID).First(&u).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return 0, ErrNotFound
		}
		return 0, err
	}
	return u.Points, nil
}

// listRecords returns a page of the user's point records plus the total count,
// scoped to userID and ordered by create_time desc. An optional changeType
// filters by ledger change type.
func (r *repo) listRecords(userID idgen.ID, q *RecordQuery) ([]model.PointRecord, int64, error) {
	tx := r.db.Model(&model.PointRecord{}).Where("user_id = ?", userID)
	if ct := strings.TrimSpace(q.ChangeType); ct != "" {
		tx = tx.Where("change_type = ?", ct)
	}

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var rows []model.PointRecord
	err := tx.Order("create_time DESC").
		Limit(q.PageSize).Offset(q.offset()).
		Find(&rows).Error
	if err != nil {
		return nil, 0, err
	}
	return rows, total, nil
}

// findCheckin loads the user's check-in row for a given YYYY-MM-DD day, if any.
// A nil record with nil error means the user has not checked in that day.
func (r *repo) findCheckin(userID idgen.ID, day string) (*model.CheckinRecord, error) {
	var rec model.CheckinRecord
	err := r.db.Where("user_id = ? AND checkin_date = ?", userID, day).First(&rec).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &rec, nil
}

// latestCheckin loads the user's most recent check-in row (by checkin_date
// desc), if any. A nil record with nil error means no prior check-in exists.
func (r *repo) latestCheckin(userID idgen.ID) (*model.CheckinRecord, error) {
	var rec model.CheckinRecord
	err := r.db.Where("user_id = ?", userID).
		Order("checkin_date DESC").First(&rec).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &rec, nil
}

// applyCheckin atomically records a check-in for (userID, day): it inserts the
// CheckinRecord (relying on the unique (user, date) index for idempotency),
// increments the user's points balance and appends a PointRecord ledger row.
//
// It returns (newBalance, true, nil) on a successful first check-in for the
// day. If the day was already checked in (unique-constraint violation), it
// returns (0, false, nil) so the caller can report rewarded=false.
func (r *repo) applyCheckin(userID idgen.ID, day string, points, continuousDays int) (int64, bool, error) {
	var newBalance int64
	rewarded := true

	err := r.db.Transaction(func(tx *gorm.DB) error {
		rec := &model.CheckinRecord{
			UserID:         userID,
			CheckinDate:    day,
			Points:         points,
			ContinuousDays: continuousDays,
		}
		rec.ID = idgen.Next()
		if err := tx.Create(rec).Error; err != nil {
			if errors.Is(err, gorm.ErrDuplicatedKey) {
				rewarded = false
				return nil
			}
			return err
		}

		// Increment the balance and read it back within the transaction.
		if err := tx.Model(&model.User{}).
			Where("id = ?", userID).
			UpdateColumn("points", gorm.Expr("points + ?", points)).Error; err != nil {
			return err
		}
		var u model.User
		if err := tx.Select("id", "points").Where("id = ?", userID).First(&u).Error; err != nil {
			return err
		}
		newBalance = u.Points

		ledger := &model.PointRecord{
			UserID:     userID,
			ChangeType: changeTypeCheckin,
			Amount:     points,
			Balance:    int(newBalance),
			Remark:     "每日签到奖励",
		}
		ledger.ID = idgen.Next()
		return tx.Create(ledger).Error
	})
	if err != nil {
		return 0, false, err
	}
	return newBalance, rewarded, nil
}
