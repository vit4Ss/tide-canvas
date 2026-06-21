package billing

import (
	"errors"

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
