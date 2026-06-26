package billing

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"

	"tidecanvas/internal/config"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/eventlog"
	"tidecanvas/internal/pkg/idgen"
)

// service.go holds billing business logic: public pricing catalogs and order
// creation / listing / cancellation with ownership scoping.

// Sentinel errors mapped to business codes by the handler.
var (
	errForbidden  = errors.New("billing: not owner")
	errBadRequest = errors.New("billing: invalid request")
)

type service struct {
	repo *repo
	cfg  *config.Config
}

func newService(db *gorm.DB, cfg *config.Config) *service {
	return &service{repo: newRepo(db), cfg: cfg}
}

// listPlans returns the on-sale subscription plans as pricing-card VOs.
func (s *service) listPlans() ([]PlanVO, error) {
	rows, err := s.repo.listPlans()
	if err != nil {
		return nil, err
	}
	vos := make([]PlanVO, 0, len(rows))
	for i := range rows {
		vos = append(vos, toPlanVO(&rows[i]))
	}
	return vos, nil
}

// listPackages returns the on-sale point top-up bundles as VOs.
func (s *service) listPackages() ([]PointPackageVO, error) {
	rows, err := s.repo.listPackages()
	if err != nil {
		return nil, err
	}
	vos := make([]PointPackageVO, 0, len(rows))
	for i := range rows {
		vos = append(vos, toPointPackageVO(&rows[i]))
	}
	return vos, nil
}

// createOrder creates a pending (status 0) order for the user. The order amount
// is taken from the referenced plan/package's price so the client cannot set
// its own price. For plans the monthly price is used; the chosen billing cycle
// (and any discounts) are applied by the payment flow in a later phase.
func (s *service) createOrder(userID idgen.ID, dto CreateOrderDTO) (*OrderVO, error) {
	o := &model.Order{
		BaseModel: model.BaseModel{ID: idgen.Next()},
		OrderNo:   genOrderNo(),
		UserID:    userID,
		OrderType: dto.Type,
		PayMethod: strings.TrimSpace(dto.PayChannel),
		Status:    0,
	}

	var (
		bizPoints  int64
		bizSummary string
	)
	switch dto.Type {
	case OrderTypePlan:
		planID, err := idgen.Parse(strings.TrimSpace(dto.PlanID))
		if err != nil || planID == 0 {
			return nil, errBadRequest
		}
		plan, err := s.repo.findPlan(planID)
		if err != nil {
			return nil, err
		}
		o.PlanID = &planID
		o.Amount = plan.Price
		bizPoints = int64(plan.PointsGrant)
		bizSummary = "购买会员套餐：" + plan.Name
	case OrderTypePackage:
		pkgID, err := idgen.Parse(strings.TrimSpace(dto.PackageID))
		if err != nil || pkgID == 0 {
			return nil, errBadRequest
		}
		pkg, err := s.repo.findPackage(pkgID)
		if err != nil {
			return nil, err
		}
		o.PackageID = &pkgID
		o.Amount = pkg.Price
		bizPoints = int64(pkg.Points + pkg.BonusPoints)
		bizSummary = "购买积分包：" + pkg.Name
	default:
		return nil, errBadRequest
	}

	if err := s.repo.createOrder(o); err != nil {
		return nil, err
	}

	eventlog.Biz(&model.BizLog{
		UserID:  userID,
		Action:  "order_create",
		Summary: bizSummary,
		Amount:  o.Amount,
		Points:  bizPoints,
		RefID:   o.ID,
		RefType: "order",
		Detail:  o.OrderNo,
	})

	vo := toOrderVO(o)
	return &vo, nil
}

// listOrders returns a page of the user's orders as VOs.
func (s *service) listOrders(userID idgen.ID, q *OrderQuery) ([]OrderVO, int64, error) {
	rows, total, err := s.repo.listOrders(userID, q)
	if err != nil {
		return nil, 0, err
	}
	vos := make([]OrderVO, 0, len(rows))
	for i := range rows {
		vos = append(vos, toOrderVO(&rows[i]))
	}
	return vos, total, nil
}

// getOrder returns a single order, enforcing ownership.
func (s *service) getOrder(id, userID idgen.ID) (*OrderVO, error) {
	o, err := s.repo.findOrder(id)
	if err != nil {
		return nil, err
	}
	if o.UserID != userID {
		return nil, errForbidden
	}
	vo := toOrderVO(o)
	return &vo, nil
}

// cancelOrder cancels the user's pending order.
func (s *service) cancelOrder(id, userID idgen.ID) error {
	if err := s.repo.cancelOrder(id, userID); err != nil {
		return err
	}
	eventlog.Biz(&model.BizLog{
		UserID:  userID,
		Action:  "order_cancel",
		Summary: "取消订单",
		RefID:   id,
		RefType: "order",
	})
	return nil
}

// genOrderNo builds a human-readable, unique order number: a timestamp prefix
// (YYYYMMDDHHMMSS) plus 6 random hex chars. The uniqueIndex on order_no is the
// hard guarantee; the random suffix avoids collisions within the same second.
func genOrderNo() string {
	ts := time.Now().Format("20060102150405")
	b := make([]byte, 3)
	if _, err := rand.Read(b); err != nil {
		return ts + idgen.Next().String()[:6]
	}
	return ts + hex.EncodeToString(b)
}
