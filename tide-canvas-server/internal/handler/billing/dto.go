package billing

// dto.go defines request payloads for billing/order endpoints. JSON tags are
// camelCase to match the frontend wire contract (tide-canvas-web).

// Order types accepted by POST /api/orders. They mirror model.Order.OrderType.
const (
	OrderTypePlan    = "plan"
	OrderTypePackage = "point_package"
)

// CreateOrderDTO is the body for POST /api/orders.
//
// Type selects what is being purchased: "plan" (requires planId) or
// "point_package" (requires packageId). PayChannel is the desired payment
// channel (e.g. wechat / alipay); it is optional and stored as pay_method.
type CreateOrderDTO struct {
	Type       string `json:"type" binding:"required,oneof=plan point_package"`
	PlanID     string `json:"planId" binding:"omitempty"`
	PackageID  string `json:"packageId" binding:"omitempty"`
	PayChannel string `json:"payChannel" binding:"omitempty,max=32"`
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
