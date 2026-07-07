package billing

import (
	"encoding/json"
	"time"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

// vo.go defines response payloads for billing/order endpoints. JSON shapes
// mirror the frontend pricing/order views (tide-canvas-web). Every id field is
// an idgen.ID (string JSON).

// PlanVO is the pricing-card view of a subscription plan. It mirrors the
// frontend Plan shape ({name, desc, mo, yr, cta, feat, items}) with explicit
// monthly/yearly/monthlyPoints fields plus the plan id.
//
// The model.Plan entity only stores a single Price and a Features JSON blob, so
// the presentation extras (yearly price, description, cta label, featured flag,
// feature bullet list) are decoded from Features here rather than adding model
// columns. Monthly price comes from Price; monthlyPoints from PointsGrant.
type PlanVO struct {
	ID            idgen.ID `json:"id"`
	Name          string   `json:"name"`
	Desc          string   `json:"desc"`
	Monthly       float64  `json:"monthly"`
	Yearly        float64  `json:"yearly"`
	MonthlyPoints int      `json:"monthlyPoints"`
	Featured      bool     `json:"featured"`
	Cta           string   `json:"cta"`
	Items         []string `json:"items"`
}

// OrderVO is the order view returned by create/list/detail.
type OrderVO struct {
	ID         idgen.ID  `json:"id"`
	OrderNo    string    `json:"orderNo"`
	Type       string    `json:"type"`
	PlanID     *idgen.ID `json:"planId"`
	Cycle      string    `json:"cycle,omitempty"`
	Amount     float64   `json:"amount"`
	Status     int       `json:"status"`
	PayTime    *string   `json:"payTime"`
	CreateTime string    `json:"createTime"`
	// ExpireTime is the checkout deadline (createTime + payTTL), present only
	// while the order is still pending so the client can show 剩余支付时间.
	ExpireTime *string `json:"expireTime,omitempty"`
	// PayURL is the epay page-jump cashier URL to redirect the browser to. Set
	// only on order creation (empty on list/detail, hence omitempty).
	PayURL string `json:"payUrl,omitempty"`
}

// planFeatures is the JSON shape stored in model.Plan.Features. It carries the
// presentation extras that have no dedicated model column.
type planFeatures struct {
	Desc     string   `json:"desc"`
	Yearly   float64  `json:"yearly"`
	Cta      string   `json:"cta"`
	Featured bool     `json:"featured"`
	Items    []string `json:"items"`
	// VipLevel is the membership level a paid purchase of this plan confers on
	// the buyer (0 = no change). Consumed by the settle flow, not exposed in VOs.
	VipLevel int `json:"vipLevel"`
}

// decodePlanFeatures decodes a plan's Features JSON blob, tolerating
// empty/invalid JSON (zero-value features).
func decodePlanFeatures(p *model.Plan) planFeatures {
	var f planFeatures
	if p.Features != "" {
		_ = json.Unmarshal([]byte(p.Features), &f)
	}
	return f
}

// toPlanVO maps a persisted plan to its pricing-card VO, decoding the Features
// JSON blob for the presentation extras.
func toPlanVO(p *model.Plan) PlanVO {
	f := decodePlanFeatures(p)
	items := f.Items
	if items == nil {
		items = []string{}
	}
	monthly, _ := p.Price.Float64()
	return PlanVO{
		ID:            p.ID,
		Name:          p.Name,
		Desc:          f.Desc,
		Monthly:       monthly,
		Yearly:        f.Yearly,
		MonthlyPoints: p.PointsGrant,
		Featured:      f.Featured,
		Cta:           f.Cta,
		Items:         items,
	}
}

// toOrderVO maps a persisted order to its VO.
func toOrderVO(o *model.Order) OrderVO {
	amount, _ := o.Amount.Float64()
	vo := OrderVO{
		ID:         o.ID,
		OrderNo:    o.OrderNo,
		Type:       o.OrderType,
		PlanID:     o.PlanID,
		Cycle:      o.Cycle,
		Amount:     amount,
		Status:     o.Status,
		CreateTime: formatTime(o.CreateTime),
	}
	if o.PayTime != nil && !o.PayTime.IsZero() {
		t := o.PayTime.Format(time.RFC3339)
		vo.PayTime = &t
	}
	if o.Status == 0 && !o.CreateTime.IsZero() {
		t := payDeadline(o.CreateTime).Format(time.RFC3339)
		vo.ExpireTime = &t
	}
	return vo
}

// formatTime renders a time as RFC3339, or "" for the zero value.
func formatTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.Format(time.RFC3339)
}
