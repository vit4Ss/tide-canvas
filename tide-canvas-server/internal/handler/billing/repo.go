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

// listPackages returns all on-sale point packages (status = 1) ordered by
// sort_order asc.
func (r *repo) listPackages() ([]model.PointPackage, error) {
	var rows []model.PointPackage
	err := r.db.Where("status = ?", 1).Order("sort_order ASC, id ASC").Find(&rows).Error
	if err != nil {
		return nil, err
	}
	return rows, nil
}

// findPackage loads a point package by primary key.
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

// createOrder inserts a new order.
func (r *repo) createOrder(o *model.Order) error {
	return r.db.Create(o).Error
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

// settleOrder atomically marks a pending order paid and grants its points in one
// transaction. Idempotency is enforced by claiming the order with a conditional
// UPDATE (WHERE status = 0): a re-delivered notify (or a return_url backstop that
// races the notify) finds RowsAffected == 0 and is a clean no-op — it never
// double-grants. Credits are added with an atomic `points + ?` expression (the
// same pattern points.applyCheckin / AI settlement use) so a concurrent balance
// change can't lose the update.
//
// grantPoints is the credits the order buys (plan.PointsGrant or
// package.Points+BonusPoints); remark is the ledger display text; transactionID
// is the gateway trade_no. Returns settled=true only when THIS call flipped the
// order from pending to paid.
func (r *repo) settleOrder(orderID idgen.ID, grantPoints int, remark, transactionID string, payTime time.Time) (bool, error) {
	settled := false
	err := r.db.Transaction(func(tx *gorm.DB) error {
		// Claim the order: only a still-pending (status 0) row is flipped to paid.
		res := tx.Model(&model.Order{}).
			Where("id = ? AND status = ?", orderID, 0).
			Updates(map[string]any{
				"status":         1,
				"pay_time":       payTime,
				"transaction_id": transactionID,
			})
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected == 0 {
			// Already paid/cancelled — idempotent no-op.
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
