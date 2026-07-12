package billing

import (
	"errors"
	"time"

	"gorm.io/gorm"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

// repo.go is the billing domain's persistence layer over *gorm.DB.

// ErrNotFound is returned when a plan / package / order lookup yields no row.
var ErrNotFound = errors.New("billing: not found")

type repo struct {
	db *gorm.DB
}

func newRepo(db *gorm.DB) *repo { return &repo{db: db} }

// listPlans returns all on-sale plans (status = 1) ordered by sort_order asc.
func (r *repo) listPlans() ([]model.Plan, error) {
	var rows []model.Plan
	err := r.db.Where("status = ?", 1).Order("sort_order ASC, id ASC").Find(&rows).Error
	if err != nil {
		return nil, err
	}
	return rows, nil
}

// userVipLevel returns the user's current membership level（重复购买拦截用）.
func (r *repo) userVipLevel(userID idgen.ID) (int, error) {
	var u struct{ VipLevel int }
	err := r.db.Model(&model.User{}).Select("vip_level").
		Where("id = ?", userID).Take(&u).Error
	return u.VipLevel, err
}

// findPlan loads a plan by primary key.
func (r *repo) findPlan(id idgen.ID) (*model.Plan, error) {
	var p model.Plan
	err := r.db.Where("id = ?", id).First(&p).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &p, nil
}

// findPackage loads a point package by primary key. Package purchase is
// discontinued; this remains so legacy point-package orders can still settle
// (resolveGrant) and display.
func (r *repo) findPackage(id idgen.ID) (*model.PointPackage, error) {
	var p model.PointPackage
	err := r.db.Where("id = ?", id).First(&p).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &p, nil
}

// enabledPayChannels returns the admin-enabled payment channels
// (pay_channel.enabled, managed at /admin/payments) in display order. The
// service filters them down to what the epay cashier actually supports.
func (r *repo) enabledPayChannels() ([]model.PayChannel, error) {
	var rows []model.PayChannel
	err := r.db.Where("enabled = ?", true).Order("sort_order ASC, id ASC").Find(&rows).Error
	if err != nil {
		return nil, err
	}
	return rows, nil
}

// createOrder inserts a new order.
func (r *repo) createOrder(o *model.Order) error {
	return r.db.Create(o).Error
}

// findReusablePending returns the user's newest still-payable pending order
// for the same plan+cycle (created after `since`), or nil when none exists —
// so repeated 立即支付 clicks resume one order instead of minting orphans.
func (r *repo) findReusablePending(userID, planID idgen.ID, cycle string, since time.Time) (*model.Order, error) {
	var o model.Order
	err := r.db.Where(
		"user_id = ? AND plan_id = ? AND cycle = ? AND status = ? AND create_time >= ?",
		userID, planID, cycle, 0, since,
	).Order("create_time DESC, id DESC").First(&o).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &o, nil
}

// updateOrderPayMethod records the buyer's latest channel choice on a reused
// pending order (kept accurate for 继续支付's cashier type).
func (r *repo) updateOrderPayMethod(id idgen.ID, method string) error {
	return r.db.Model(&model.Order{}).Where("id = ?", id).
		UpdateColumn("pay_method", method).Error
}

// cancelExpiredOrders lazily flips the user's expired pending orders (created
// before `cutoff`) to 已取消. Called on list so 待支付 rows are always payable.
func (r *repo) cancelExpiredOrders(userID idgen.ID, cutoff time.Time) error {
	return r.db.Model(&model.Order{}).
		Where("user_id = ? AND status = ? AND create_time < ?", userID, 0, cutoff).
		Update("status", 2).Error
}

// cancelExpiredByID flips one expired pending order to 已取消 (caller checked
// the deadline). Conditional on status 0 so it never downgrades a paid order.
func (r *repo) cancelExpiredByID(id idgen.ID) error {
	return r.db.Model(&model.Order{}).
		Where("id = ? AND status = ?", id, 0).
		Update("status", 2).Error
}

// listOrders returns a page of the user's orders plus the total count, newest
// first. Optionally filtered by status and order type.
func (r *repo) listOrders(userID idgen.ID, q *OrderQuery) ([]model.Order, int64, error) {
	tx := r.db.Model(&model.Order{}).Where("user_id = ?", userID)
	if q.Status != nil {
		tx = tx.Where("status = ?", *q.Status)
	}
	if q.Type != "" {
		tx = tx.Where("order_type = ?", q.Type)
	}

	var total int64
	if err := tx.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var rows []model.Order
	err := tx.Order("create_time DESC, id DESC").
		Limit(q.PageSize).Offset(q.offset()).Find(&rows).Error
	if err != nil {
		return nil, 0, err
	}
	return rows, total, nil
}

// findOrder loads an order by primary key (any owner).
func (r *repo) findOrder(id idgen.ID) (*model.Order, error) {
	var o model.Order
	err := r.db.Where("id = ?", id).First(&o).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &o, nil
}

// findOrderByNo loads an order by its order_no (the epay out_trade_no).
func (r *repo) findOrderByNo(orderNo string) (*model.Order, error) {
	var o model.Order
	err := r.db.Where("order_no = ?", orderNo).First(&o).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return &o, nil
}

// settleOrder atomically marks an order paid and grants its points in one
// transaction. Idempotency is enforced by claiming the order with a conditional
// UPDATE (WHERE status IN (0,2)): a re-delivered notify (or a return_url
// backstop that races the notify) finds RowsAffected == 0 and is a clean no-op
// — it never double-grants. Cancelled (2) is claimable on purpose: an order the
// user cancelled or that lazily expired can still be PAID through a stale
// cashier tab / late notify, and paid money must always convert to credits (the
// amount was verified upstream) rather than being silently swallowed. Credits
// are added with an atomic `points + ?` expression (the same pattern
// points.applyCheckin / AI settlement use) so a concurrent balance change can't
// lose the update.
//
// grantPoints is the credits the order buys (plan.PointsGrant or
// package.Points+BonusPoints); vipLevel, when > 0, lifts the buyer's membership
// level (upgrade-only — a lower plan never downgrades an existing level);
// remark is the ledger display text; transactionID is the gateway trade_no.
// Returns settled=true only when THIS call flipped the order from pending to
// paid.
func (r *repo) settleOrder(orderID idgen.ID, grantPoints, vipLevel int, remark, transactionID string, payTime time.Time) (bool, error) {
	settled := false
	err := r.db.Transaction(func(tx *gorm.DB) error {
		// Claim the order: pending (0) or cancelled/expired (2) flips to paid.
		res := tx.Model(&model.Order{}).
			Where("id = ? AND status IN ?", orderID, []int{0, 2}).
			Updates(map[string]any{
				"status":         1,
				"pay_time":       payTime,
				"transaction_id": transactionID,
			})
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			// Already paid (or refunded) — idempotent no-op.
			return nil
		}

		// Load the order to know who to credit.
		var o model.Order
		if err := tx.Where("id = ?", orderID).First(&o).Error; err != nil {
			return err
		}

		if grantPoints != 0 {
			if err := tx.Model(&model.User{}).
				Where("id = ?", o.UserID).
				UpdateColumn("points", gorm.Expr("points + ?", grantPoints)).Error; err != nil {
				return err
			}
			var u model.User
			if err := tx.Select("id", "points").Where("id = ?", o.UserID).First(&u).Error; err != nil {
				return err
			}
			refID := o.ID
			ledger := &model.PointRecord{
				UserID:     o.UserID,
				ChangeType: "recharge",
				Amount:     grantPoints,
				Balance:    int(u.Points),
				Remark:     remark,
				RefID:      &refID,
			}
			ledger.ID = idgen.Next()
			if err := tx.Create(ledger).Error; err != nil {
				return err
			}
		}

		if vipLevel > 0 {
			if err := tx.Model(&model.User{}).
				Where("id = ? AND vip_level < ?", o.UserID, vipLevel).
				UpdateColumn("vip_level", vipLevel).Error; err != nil {
				return err
			}
		}

		settled = true
		return nil
	})
	if err != nil {
		return false, err
	}
	return settled, nil
}

// cancelOrder marks a pending order (status 0) as cancelled (status 2), scoped
// to (id, userID). It returns ErrNotFound when no matching pending order
// existed (already paid/cancelled orders are not affected).
func (r *repo) cancelOrder(id, userID idgen.ID) error {
	res := r.db.Model(&model.Order{}).
		Where("id = ? AND user_id = ? AND status = ?", id, userID, 0).
		Update("status", 2)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return ErrNotFound
	}
	return nil
}
