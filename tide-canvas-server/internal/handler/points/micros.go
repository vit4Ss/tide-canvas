package points

import (
	"errors"
	"math"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

var ErrInvalidBalance = errors.New("points: invalid fractional balance")

func BalanceMicros(user *model.User) (int64, error) {
	if user.Points < 0 || user.Points > (math.MaxInt64-model.PointScale)/model.PointScale || user.PointFraction < 0 || user.PointFraction >= model.PointScale {
		return 0, ErrInvalidBalance
	}
	total := user.Points*model.PointScale + user.PointFraction
	if user.PointHeldMicros < 0 || user.PointHeldMicros > total {
		return 0, ErrInvalidBalance
	}
	return total - user.PointHeldMicros, nil
}

// HoldMicros changes only the reservation, not the financial ledger balance.
func HoldMicros(tx *gorm.DB, uid idgen.ID, delta int64) error {
	var user model.User
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&user, "id = ?", uid).Error; err != nil {
		return err
	}
	available, err := BalanceMicros(&user)
	if err != nil {
		return err
	}
	if delta > available {
		return ErrInsufficient
	}
	if delta < -user.PointHeldMicros {
		return ErrInvalidBalance
	}
	return tx.Model(&user).Update("point_held_micros", user.PointHeldMicros+delta).Error
}

// ChangeMicros must be composed with the caller's durable request state change
// in one transaction. It never rounds a fractional debit to a whole point.
func ChangeMicros(tx *gorm.DB, uid idgen.ID, delta int64, changeType, remark string, refID idgen.ID) error {
	if delta == 0 {
		return nil
	}
	_, err := changeMicros(tx, uid, delta, changeType, remark, refID)
	return err
}

// AdjustWhole retains the existing integer adjustment API, but clamps a debit
// to unreserved funds and records the actual fractional amount when necessary.
func AdjustWhole(tx *gorm.DB, uid idgen.ID, amount int64, changeType, remark string, refID idgen.ID) (*model.PointRecord, error) {
	if amount > math.MaxInt64/model.PointScale || amount < math.MinInt64/model.PointScale {
		return nil, ErrInvalidBalance
	}
	var user model.User
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&user, "id = ?", uid).Error; err != nil {
		return nil, err
	}
	available, err := BalanceMicros(&user)
	if err != nil {
		return nil, err
	}
	delta := amount * model.PointScale
	if delta < -available {
		delta = -available
	}
	return changeMicros(tx, uid, delta, changeType, remark, refID)
}

func changeMicros(tx *gorm.DB, uid idgen.ID, delta int64, changeType, remark string, refID idgen.ID) (*model.PointRecord, error) {
	var user model.User
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&user, "id = ?", uid).Error; err != nil {
		return nil, err
	}
	balance, err := BalanceMicros(&user)
	if err != nil {
		return nil, err
	}
	if delta < -balance {
		return nil, ErrInsufficient
	}
	balance += user.PointHeldMicros
	if delta > math.MaxInt64-balance {
		return nil, ErrInvalidBalance
	}
	balance += delta
	if err := tx.Model(&user).Updates(map[string]any{"points": balance / model.PointScale, "point_fraction": balance % model.PointScale}).Error; err != nil {
		return nil, err
	}
	record := model.PointRecord{UserID: uid, ChangeType: changeType, Amount: int(delta / model.PointScale), Balance: int(balance / model.PointScale), AmountMicros: &delta, BalanceMicros: &balance, Remark: remark}
	if refID != 0 {
		record.RefID = &refID
	}
	return &record, tx.Create(&record).Error
}
