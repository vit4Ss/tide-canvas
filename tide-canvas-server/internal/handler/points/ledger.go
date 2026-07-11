package points

import (
	"errors"
	"strconv"
	"strings"

	"gorm.io/gorm"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

// ledger.go holds the cross-domain point mutation primitives: the guarded
// deduction (Consume), the credit-back (Refund) and the signup grant. These are
// exported so other domains (ai generation, auth registration) can spend/grant
// points transactionally without duplicating the balance+ledger bookkeeping.

// ErrInsufficient is returned by Consume when the user's usable balance is below
// the requested amount (or the user does not exist).
var ErrInsufficient = errors.New("points: insufficient balance")

// Ledger ChangeType values written to PointRecord.ChangeType.
const (
	ChangeConsume = "consume"
	ChangeRefund  = "refund"
	ChangeSignup  = "signup"
)

// mutate applies a signed balance delta to a user inside tx and appends one
// PointRecord row. A negative delta uses a guarded UPDATE (points >= -delta) so
// concurrent generations can never drive the balance below zero; a guard miss
// (user missing or balance too low) returns ErrInsufficient. Returns the new
// balance.
func mutate(tx *gorm.DB, userID idgen.ID, delta int, changeType, remark string, refID idgen.ID) (int64, error) {
	q := tx.Model(&model.User{}).Where("id = ?", userID)
	if delta < 0 {
		q = q.Where("points >= ?", -delta)
	}
	res := q.UpdateColumn("points", gorm.Expr("points + ?", delta))
	if res.Error != nil {
		return 0, res.Error
	}
	if res.RowsAffected == 0 {
		if delta < 0 {
			return 0, ErrInsufficient
		}
		return 0, ErrNotFound // positive delta but the user row is missing
	}

	var u model.User
	if err := tx.Select("id", "points").Where("id = ?", userID).First(&u).Error; err != nil {
		return 0, err
	}

	rec := &model.PointRecord{
		UserID:     userID,
		ChangeType: changeType,
		Amount:     delta,
		Balance:    int(u.Points),
		Remark:     remark,
	}
	rec.ID = idgen.Next()
	if refID != 0 {
		rid := refID
		rec.RefID = &rid
	}
	if err := tx.Create(rec).Error; err != nil {
		return 0, err
	}
	return u.Points, nil
}

// Consume atomically deducts amount points (guarded against overspend) and
// writes a "consume" ledger row keyed to refID. amount <= 0 is a no-op. Returns
// ErrInsufficient when the balance is below amount.
func Consume(db *gorm.DB, userID idgen.ID, amount int, remark string, refID idgen.ID) error {
	if amount <= 0 {
		return nil
	}
	return db.Transaction(func(tx *gorm.DB) error {
		_, err := mutate(tx, userID, -amount, ChangeConsume, remark, refID)
		return err
	})
}

// Refund atomically credits amount points back (e.g. a failed/cancelled
// generation) and writes a "refund" ledger row keyed to refID. amount <= 0 is a
// no-op.
func Refund(db *gorm.DB, userID idgen.ID, amount int, remark string, refID idgen.ID) error {
	if amount <= 0 {
		return nil
	}
	return db.Transaction(func(tx *gorm.DB) error {
		_, err := mutate(tx, userID, amount, ChangeRefund, remark, refID)
		return err
	})
}

// GrantSignup grants the admin-configured signup bonus to a freshly created
// user and writes a "signup" ledger row. The amount comes from sys_config
// points.signupBonus（后台「积分全局配置 · 注册赠送」旋钮）, falling back to
// the legacy ai.default_points（配置管理）when unset/invalid. A missing / zero
// config is a no-op. Returns the granted amount so the caller can reflect it
// in the immediate response.
func GrantSignup(db *gorm.DB, userID idgen.ID) (int, error) {
	amount := signupGrant(db)
	if amount <= 0 {
		return 0, nil
	}
	err := db.Transaction(func(tx *gorm.DB) error {
		_, e := mutate(tx, userID, amount, ChangeSignup, "注册奖励", 0)
		return e
	})
	if err != nil {
		return 0, err
	}
	return amount, nil
}

// signupGrant reads the new-user bonus: points.signupBonus first（积分管理页
// 「注册赠送」）, legacy ai.default_points（配置管理）as fallback. 显式配 0 表示
// 不发（不会落到 fallback）；两个键都缺失/非法时返回 0。
func signupGrant(db *gorm.DB) int {
	for _, key := range []string{"points.signupBonus", "ai.default_points"} {
		var row model.SysConfig
		if err := db.Select("config_value").
			Where("config_key = ?", key).First(&row).Error; err != nil {
			continue
		}
		n, err := strconv.Atoi(strings.TrimSpace(row.ConfigValue))
		if err != nil || n < 0 {
			continue
		}
		return n
	}
	return 0
}
