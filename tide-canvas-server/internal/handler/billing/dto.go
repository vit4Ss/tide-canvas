package billing

// dto.go defines request payloads for billing/order endpoints. JSON tags are
// camelCase to match the frontend wire contract (tide-canvas-web).

// Order types stored in model.Order.OrderType. Only plan orders can be
// CREATED — 积分随套餐发放，单独积分包购买已下线（产品决策，2026-07）。
// OrderTypePackage remains for settling/displaying legacy package orders.
const (
	OrderTypePlan    = "plan"
	OrderTypePackage = "point_package"
)

// Billing cycles accepted for plan orders. They mirror model.Order.Cycle.
const (
	CycleMonthly = "monthly"
	CycleYearly  = "yearly"
)

// CreateOrderDTO is the body for POST /api/orders.
//
// Only "plan" purchases are accepted (requires planId). PayChannel is the
// desired payment channel (e.g. wechat / alipay); it is optional and stored
// as pay_method.
type CreateOrderDTO struct {
	Type       string `json:"type" binding:"required,oneof=plan"`
	PlanID     string `json:"planId" binding:"required"`
	PayChannel string `json:"payChannel" binding:"omitempty,max=32"`
	// Cycle selects the billing cycle for plan orders: "monthly" (default) or
	// "yearly" (charged 12 × the plan's discounted per-month yearly price, grants
	// 12 × the monthly points). Ignored for point-package orders.
	Cycle string `json:"cycle" binding:"omitempty,oneof=monthly yearly"`
}

// OrderQuery is the query for GET /api/orders (OrderQuery + PageQuery).
type OrderQuery struct {
	PageNum  int `form:"pageNum"`
	PageSize int `form:"pageSize"`
	// Status filters by order status when non-nil
	// (0 待支付 / 1 已支付 / 2 已取消 / 3 已退款).
	Status *int `form:"status"`
	// Type filters by order type ("plan" / "point_package") when non-empty.
	Type string `form:"type"`
}

// normalize applies defaults and clamps for pagination.
func (q *OrderQuery) normalize() {
	if q.PageNum <= 0 {
		q.PageNum = 1
	}
	if q.PageSize <= 0 {
		q.PageSize = 10
	}
	if q.PageSize > 100 {
		q.PageSize = 100
	}
}

// offset returns the SQL offset for the current page.
func (q *OrderQuery) offset() int { return (q.PageNum - 1) * q.PageSize }
