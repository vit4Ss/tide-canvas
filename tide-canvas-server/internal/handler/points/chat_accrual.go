package points

import (
	"math"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

// AccrueChatCost must run in the same transaction as the request settlement,
// after releasing that request's hold. Costs are micro-points; only completed
// whole points are debited. The locked user row shares one remainder across
// providers, models, API-key revisions and concurrent requests.
func AccrueChatCost(tx *gorm.DB, uid idgen.ID, cost int64, remark string, refID idgen.ID) (debit, pending int64, err error) {
	var user model.User
	if err = tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&user, "id = ?", uid).Error; err != nil {
		return
	}
	available, e := BalanceMicros(&user)
	if e != nil {
		return 0, 0, e
	}
	if cost < 0 {
		return 0, 0, ErrInvalidBalance
	}
	if cost > available {
		return 0, 0, ErrInsufficient
	}
	// The available-balance check bounds the addition below by the wallet total.
	total := user.ChatPendingMicros + cost
	debit = (total / model.PointScale) * model.PointScale
	pending = total % model.PointScale
	if cost == 0 {
		return 0, pending, nil
	}
	// Replace the old remainder before debiting, so the settled portion is not
	// counted twice as occupied funds. Both updates roll back with the caller.
	if err = tx.Model(&user).Update("chat_pending_micros", pending).Error; err != nil {
		return
	}
	err = ChangeMicros(tx, uid, -debit, ChangeConsume, remark, refID)
	return
}

// RefundAccruedChatBill reverses this bill's fee, not the integer debit that
// happened to cross a threshold on that call. The bill row is the refund fence.
// Must be called inside the caller's refund transaction.
func RefundAccruedChatBill(tx *gorm.DB, uid, billID idgen.ID, remark string) (refunded bool, walletReturn int64, err error) {
	var bill model.ModelGatewayRequest
	if err = tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&bill, "id = ? AND user_id = ? AND settlement_mode = ?", billID, uid, model.ChatSettlementAccumulated).Error; err != nil {
		return
	}
	if bill.RefundedCostMicros > 0 {
		return false, 0, nil
	}
	if bill.CostMicros <= 0 || (bill.Status != "success" && bill.Status != "partial") {
		return false, 0, ErrInvalidBalance
	}
	var user model.User
	if err = tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&user, "id = ?", uid).Error; err != nil {
		return
	}
	if _, err = BalanceMicros(&user); err != nil {
		return
	}
	pending := user.ChatPendingMicros - bill.CostMicros
	if pending < 0 {
		deficit := -pending
		whole := deficit / model.PointScale
		if deficit%model.PointScale != 0 {
			whole++
		}
		if whole > math.MaxInt64/model.PointScale {
			return false, 0, ErrInvalidBalance
		}
		walletReturn = whole * model.PointScale
		pending = walletReturn - deficit
		if err = ChangeMicros(tx, uid, walletReturn, ChangeRefund, remark, billID); err != nil {
			return
		}
	}
	if err = tx.Model(&user).Update("chat_pending_micros", pending).Error; err != nil {
		return
	}
	err = tx.Model(&bill).Updates(map[string]any{"refunded_cost_micros": bill.CostMicros, "wallet_refund_micros": walletReturn}).Error
	return err == nil, walletReturn, err
}
