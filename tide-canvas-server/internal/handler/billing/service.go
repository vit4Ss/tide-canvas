package billing

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"github.com/shopspring/decimal"
	"go.uber.org/zap"
	"gorm.io/gorm"

	"tidecanvas/internal/config"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/epay"
	"tidecanvas/internal/pkg/eventlog"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/logger"
)

// service.go holds billing business logic: public pricing catalogs and order
// creation / listing / cancellation with ownership scoping.

// Sentinel errors mapped to business codes by the handler.
var (
	errForbidden       = errors.New("billing: not owner")
	errBadRequest      = errors.New("billing: invalid request")
	errPayUnavailable  = errors.New("billing: payment gateway unavailable")
	errChannelDisabled = errors.New("billing: pay channel not enabled")
)

// payTTL is how long a pending order stays payable. After the deadline the
// client gets no cashier URL and lists lazily flip the order to 已取消 —— but a
// payment that still lands (stale cashier tab, late notify) is HONORED: settle
// claims status 0 or 2, so the buyer's money always converts to credits. The
// window only bounds how long we keep offering checkout, it never swallows
// paid money.
const payTTL = 30 * time.Minute

// payDeadline is the last instant an order created at t can start checkout.
func payDeadline(t time.Time) time.Time { return t.Add(payTTL) }

type service struct {
	repo *repo
	cfg  *config.Config
	pay  *epay.Client
}

func newService(db *gorm.DB, cfg *config.Config) *service {
	pc := epay.New(epay.Config{
		Enabled:    cfg.Eliandapay.Enabled,
		Gateway:    cfg.Eliandapay.Gateway,
		MerchantID: cfg.Eliandapay.MerchantID,
		MD5Key:     cfg.Eliandapay.MD5Key,
		NotifyURL:  cfg.Eliandapay.NotifyURL,
		ReturnURL:  cfg.Eliandapay.ReturnURL,
	}, nil)
	return &service{repo: newRepo(db), cfg: cfg, pay: pc}
}

// payType maps the frontend payChannel to an epay pay method. WeChat has several
// aliases; anything unrecognized (or empty) defaults to Alipay so the cashier
// always has a valid method.
func payType(channel string) string {
	switch strings.ToLower(strings.TrimSpace(channel)) {
	case "wxpay", "wechat", "weixin", "wx":
		return "wxpay"
	default:
		return "alipay"
	}
}

// payKey normalizes an admin pay_channel.Type (or a client payChannel) to an
// epay cashier key, or "" when the type is not supported by the epay gateway
// (e.g. stripe/paypal rows the admin may keep for other purposes).
func payKey(t string) string {
	switch strings.ToLower(strings.TrimSpace(t)) {
	case "alipay":
		return "alipay"
	case "wxpay", "wechat", "weixin", "wx":
		return "wxpay"
	}
	return ""
}

// PayChannelVO is one selectable cashier pay method, driven by the admin
// 支付渠道 configuration (/admin/payments → pay_channel.enabled).
type PayChannelVO struct {
	Key  string `json:"key"`  // epay method: "alipay" | "wxpay"
	Name string `json:"name"` // display name from the admin channel row
}

// listPayChannels returns the admin-enabled channels the cashier can serve,
// normalized to epay keys, deduped, in the admin's sort order. An empty result
// means checkout is effectively closed (the client shows 未开通).
func (s *service) listPayChannels() ([]PayChannelVO, error) {
	rows, err := s.repo.enabledPayChannels()
	if err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	vos := make([]PayChannelVO, 0, 2)
	for i := range rows {
		k := payKey(rows[i].Type)
		if k == "" || seen[k] {
			continue
		}
		seen[k] = true
		vos = append(vos, PayChannelVO{Key: k, Name: rows[i].Name})
	}
	return vos, nil
}

// enabledPayKeySet is listPayChannels reduced to a membership set, used to
// validate order creation against the admin configuration.
func (s *service) enabledPayKeySet() (map[string]bool, error) {
	vos, err := s.listPayChannels()
	if err != nil {
		return nil, err
	}
	set := make(map[string]bool, len(vos))
	for _, v := range vos {
		set[v.Key] = true
	}
	return set, nil
}

// planPricing resolves the authoritative charge and points grant for a plan
// order under the chosen billing cycle. Monthly uses the plan's Price /
// PointsGrant as-is; yearly charges 12 × the discounted per-month price stored
// in Features and grants 12 × the monthly points. A plan without a yearly
// price cannot be bought yearly.
func planPricing(plan *model.Plan, cycle string) (decimal.Decimal, int, error) {
	if cycle != CycleYearly {
		return plan.Price, plan.PointsGrant, nil
	}
	f := decodePlanFeatures(plan)
	if f.Yearly <= 0 {
		return decimal.Zero, 0, errBadRequest
	}
	price := decimal.NewFromFloat(f.Yearly).Mul(decimal.NewFromInt(12)).Round(2)
	return price, plan.PointsGrant * 12, nil
}

// planOrderName renders the ledger/cashier display name for a plan order.
func planOrderName(plan *model.Plan, cycle string) string {
	name := "购买会员套餐：" + plan.Name
	if cycle == CycleYearly {
		name += "（年付）"
	}
	return name
}

// vipForPlan maps a plan to the membership level its purchase confers: an
// explicit features.vipLevel wins, else the seeded plan codes, else 0 (no
// change — points only).
func vipForPlan(plan *model.Plan) int {
	if f := decodePlanFeatures(plan); f.VipLevel > 0 {
		return f.VipLevel
	}
	switch plan.Code {
	case "pro":
		return 1
	case "enterprise":
		return 2
	}
	return 0
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

// createOrder creates a pending (status 0) order for the user. The order amount
// is taken from the referenced plan/package's price so the client cannot set
// its own price. For plans the chosen billing cycle drives the charge: monthly
// = Price, yearly = 12 × the discounted per-month Features price.
func (s *service) createOrder(userID idgen.ID, dto CreateOrderDTO) (*OrderVO, error) {
	// The requested pay channel must be one the admin has enabled
	// (/admin/payments → pay_channel.enabled) AND the epay cashier supports.
	chKey := payKey(dto.PayChannel)
	enabled, err := s.enabledPayKeySet()
	if err != nil {
		return nil, err
	}
	if chKey == "" || !enabled[chKey] {
		return nil, errChannelDisabled
	}

	o := &model.Order{
		BaseModel: model.BaseModel{ID: idgen.Next()},
		OrderNo:   genOrderNo(),
		UserID:    userID,
		OrderType: dto.Type,
		PayMethod: chKey,
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
		cycle := dto.Cycle
		if cycle == "" {
			cycle = CycleMonthly
		}
		price, points, err := planPricing(plan, cycle)
		if err != nil {
			return nil, err
		}

		// Reuse an existing, still-payable pending order for the same
		// plan+cycle instead of minting a new row on every 立即支付 click —
		// no orphan spam, no double-charge from two live cashier tabs.
		if prev, err := s.repo.findReusablePending(userID, planID, cycle, time.Now().Add(-payTTL)); err == nil && prev != nil {
			if prev.PayMethod != chKey {
				if err := s.repo.updateOrderPayMethod(prev.ID, chKey); err == nil {
					prev.PayMethod = chKey
				}
			}
			vo := toOrderVO(prev)
			if s.pay.Enabled() {
				url, err := s.pay.CheckoutURL(epay.CheckoutParams{
					Type:       payType(prev.PayMethod),
					OutTradeNo: prev.OrderNo,
					Name:       planOrderName(plan, cycle),
					Money:      prev.Amount,
					Param:      userID.String() + ":" + prev.OrderNo,
				})
				if err != nil {
					logger.L().Error("billing: rebuild checkout url failed", zap.String("orderNo", prev.OrderNo), zap.Error(err))
					return nil, errPayUnavailable
				}
				vo.PayURL = url
			}
			return &vo, nil
		}

		o.PlanID = &planID
		o.Cycle = cycle
		o.Amount = price
		bizPoints = int64(points)
		bizSummary = planOrderName(plan, cycle)
	default:
		// 积分包（point_package）购买通道已下线：积分只随套餐发放。
		// 遗留的积分包订单仍可通过 resolveGrant 正常结算/展示。
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

	// Build the epay page-jump cashier URL. out_trade_no is the order number and
	// param round-trips userID:orderNo so the async notify can attribute the
	// payment without a second lookup. Credits are granted by the notify, not here.
	if s.pay.Enabled() {
		url, err := s.pay.CheckoutURL(epay.CheckoutParams{
			Type:       chKey,
			OutTradeNo: o.OrderNo,
			Name:       bizSummary,
			Money:      o.Amount,
			Param:      userID.String() + ":" + o.OrderNo,
		})
		if err != nil {
			// Order row is already persisted (pending); surface a clear error so the
			// client can retry payment without losing the order.
			logger.L().Error("billing: build checkout url failed", zap.String("orderNo", o.OrderNo), zap.Error(err))
			return nil, errPayUnavailable
		}
		vo.PayURL = url
	}

	return &vo, nil
}

// orderGrant is what a paid order awards: the credited points, a ledger display
// name, the authoritative price to verify the paid amount against, and the
// membership level conferred (0 = points only).
type orderGrant struct {
	points   int
	name     string
	price    decimal.Decimal
	vipLevel int
}

// resolveGrant reconstructs what an order grants from its plan/package reference.
// The price is the canonical amount the buyer must have paid (anti-tamper). It is
// read live from the plan/package so a mid-flight price edit can't be exploited,
// mirroring the order.Amount captured at creation.
func (s *service) resolveGrant(o *model.Order) (*orderGrant, error) {
	switch o.OrderType {
	case OrderTypePlan:
		if o.PlanID == nil {
			return nil, errBadRequest
		}
		plan, err := s.repo.findPlan(*o.PlanID)
		if err != nil {
			return nil, err
		}
		price, points, err := planPricing(plan, o.Cycle)
		if err != nil {
			return nil, err
		}
		return &orderGrant{
			points:   points,
			name:     planOrderName(plan, o.Cycle),
			price:    price,
			vipLevel: vipForPlan(plan),
		}, nil
	case OrderTypePackage:
		if o.PackageID == nil {
			return nil, errBadRequest
		}
		pkg, err := s.repo.findPackage(*o.PackageID)
		if err != nil {
			return nil, err
		}
		return &orderGrant{points: pkg.Points + pkg.BonusPoints, name: "购买积分包：" + pkg.Name, price: pkg.Price}, nil
	default:
		return nil, errBadRequest
	}
}

// settleNotify verifies + applies an async payment notify. It returns true (the
// handler then replies the literal "success") when the sign is valid, the trade
// succeeded, the paid amount matches the order, and credits were granted (or the
// order was already settled — idempotent). Any failure returns false so the
// gateway keeps retrying.
func (s *service) settleNotify(raw map[string]string) bool {
	if !s.pay.Enabled() {
		return false
	}
	res, err := s.pay.VerifyNotify(raw)
	if err != nil {
		logger.L().Warn("billing: notify rejected", zap.Error(err))
		return false
	}

	o, err := s.repo.findOrderByNo(res.OutTradeNo)
	if err != nil {
		logger.L().Warn("billing: notify for unknown order", zap.String("orderNo", res.OutTradeNo))
		return false
	}

	// Ownership defense: the round-tripped param must name this order's buyer.
	if ownerID, ok := paramOwner(res.Param); ok && ownerID != o.UserID.String() {
		logger.L().Warn("billing: notify owner mismatch", zap.String("orderNo", res.OutTradeNo))
		return false
	}

	grant, err := s.resolveGrant(o)
	if err != nil {
		logger.L().Warn("billing: notify unresolvable order", zap.String("orderNo", res.OutTradeNo), zap.Error(err))
		return false
	}

	// Anti-tamper: paid amount must match the order price to the cent.
	if res.Money.Round(2).Cmp(o.Amount.Round(2)) != 0 {
		logger.L().Warn("billing: notify amount mismatch",
			zap.String("orderNo", res.OutTradeNo),
			zap.String("paid", epay.Money(res.Money)),
			zap.String("expected", epay.Money(o.Amount)))
		return false
	}

	if _, err := s.repo.settleOrder(o.ID, grant.points, grant.vipLevel, grant.name, res.TradeNo, time.Now()); err != nil {
		logger.L().Error("billing: settle failed", zap.String("orderNo", res.OutTradeNo), zap.Error(err))
		return false
	}
	return true
}

// VerifyResult reports whether an order is paid and whether this call granted it.
type VerifyResult struct {
	Paid    bool `json:"paid"`
	Granted bool `json:"granted"`
}

// verifyOrder is the return_url backstop for a dropped async notify: it queries
// the gateway by order number and, if the order is paid, belongs to userID and
// the amount matches, grants the credits idempotently (same order key as the
// notify, so it can never double-grant even if the notify also lands).
func (s *service) verifyOrder(ctx context.Context, userID idgen.ID, orderNo string) (*VerifyResult, error) {
	if !s.pay.Enabled() {
		return &VerifyResult{}, nil
	}
	o, err := s.repo.findOrderByNo(strings.TrimSpace(orderNo))
	if err != nil {
		return &VerifyResult{}, nil
	}
	// Never let a user credit themselves off another buyer's order number.
	if o.UserID != userID {
		return &VerifyResult{}, nil
	}
	if o.Status == 1 {
		return &VerifyResult{Paid: true, Granted: false}, nil
	}

	st, err := s.pay.QueryOrder(ctx, o.OrderNo)
	if err != nil {
		logger.L().Warn("billing: order query failed", zap.String("orderNo", o.OrderNo), zap.Error(err))
		return &VerifyResult{}, nil
	}
	if !st.Paid {
		return &VerifyResult{Paid: false, Granted: false}, nil
	}

	grant, err := s.resolveGrant(o)
	if err != nil {
		return &VerifyResult{Paid: true, Granted: false}, nil
	}
	if st.Money == nil || st.Money.Round(2).Cmp(o.Amount.Round(2)) != 0 {
		logger.L().Warn("billing: verify amount mismatch", zap.String("orderNo", o.OrderNo))
		return &VerifyResult{Paid: true, Granted: false}, nil
	}

	settled, err := s.repo.settleOrder(o.ID, grant.points, grant.vipLevel, grant.name, st.TradeNo, time.Now())
	if err != nil {
		logger.L().Error("billing: verify settle failed", zap.String("orderNo", o.OrderNo), zap.Error(err))
		return &VerifyResult{Paid: true, Granted: false}, nil
	}
	return &VerifyResult{Paid: true, Granted: settled}, nil
}

// paramOwner extracts the userID from a round-tripped "userID:orderNo" param.
func paramOwner(param string) (string, bool) {
	i := strings.IndexByte(param, ':')
	if i <= 0 {
		return "", false
	}
	return param[:i], true
}

// listOrders returns a page of the user's orders as VOs. Expired pending
// orders are lazily flipped to 已取消 first so the list never shows a 待支付
// row that can no longer start checkout.
func (s *service) listOrders(userID idgen.ID, q *OrderQuery) ([]OrderVO, int64, error) {
	if err := s.repo.cancelExpiredOrders(userID, time.Now().Add(-payTTL)); err != nil {
		logger.L().Warn("billing: expire sweep failed", zap.Error(err))
	}
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

// getOrder returns a single order, enforcing ownership. A still-payable
// pending order gets a fresh cashier URL (the create-time URL is never
// persisted) so the client can offer 继续支付; an expired pending order is
// lazily flipped to 已取消 and gets NO cashier URL.
func (s *service) getOrder(id, userID idgen.ID) (*OrderVO, error) {
	o, err := s.repo.findOrder(id)
	if err != nil {
		return nil, err
	}
	if o.UserID != userID {
		return nil, errForbidden
	}
	if o.Status == 0 && time.Now().After(payDeadline(o.CreateTime)) {
		if err := s.repo.cancelExpiredByID(o.ID); err == nil {
			o.Status = 2
		}
	}
	vo := toOrderVO(o)
	if o.Status == 0 && s.pay.Enabled() {
		if grant, err := s.resolveGrant(o); err == nil {
			url, err := s.pay.CheckoutURL(epay.CheckoutParams{
				Type:       payType(o.PayMethod),
				OutTradeNo: o.OrderNo,
				Name:       grant.name,
				Money:      o.Amount,
				Param:      o.UserID.String() + ":" + o.OrderNo,
			})
			if err == nil {
				vo.PayURL = url
			}
		}
	}
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
