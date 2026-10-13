package billing

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"tidecanvas/internal/handler/points"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

type pancakePurchase struct {
	stripePurchase
	StoreID   string `json:"storeId"`
	ProductID string `json:"productId"`
	Nonce     string `json:"nonce"`
}
type pancakeOrder struct {
	RefundIDs  []string          `json:"refundIds"`
	ProviderID string            `json:"providerId"`
	Reference  string            `json:"reference"`
	StoreID    string            `json:"storeId"`
	ProductID  string            `json:"productId"`
	Mode       string            `json:"mode"`
	Currency   string            `json:"currency"`
	Metadata   map[string]string `json:"metadata"`
	Subtotal   decimal.Decimal   `json:"subtotal"`
	Total      decimal.Decimal   `json:"total"`
	Tax        decimal.Decimal   `json:"tax"`
	Refunded   decimal.Decimal   `json:"refunded"`
	PaymentID  string            `json:"paymentId"`
	Paid       bool              `json:"paid"`
	Processing bool              `json:"processing"`
	Canceled   bool              `json:"canceled"`
}

func pancakeRef(env string, id idgen.ID) string {
	return "framelyn-" + stripeMode(env) + "-" + id.String()
}
func safePancakeURL(raw string) bool {
	u, e := url.Parse(raw)
	return e == nil && u.Scheme == "https" && u.Host == "checkout.waffo.ai" && u.User == nil
}
func (s *service) pancakeCall(ctx context.Context, path string, body []byte, signature string, out any) error {
	if !s.cfg.Pancake.Configured() || s.cfg.Pancake.Validate(s.cfg.Env) != nil {
		return errUSDCheckoutUnavailable
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.cfg.Pancake.AdapterURL+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+s.cfg.Pancake.InternalToken)
	req.Header.Set("Content-Type", "application/json")
	if signature != "" {
		req.Header.Set("X-Waffo-Signature", signature)
	}
	client := &http.Client{Timeout: 25 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := client.Do(req)
	if err != nil {
		return errPayUnavailable
	}
	defer resp.Body.Close()
	if resp.StatusCode == 400 {
		return errBadRequest
	}
	if resp.StatusCode != 200 {
		return errPayUnavailable
	}
	return json.NewDecoder(io.LimitReader(resp.Body, 2<<20)).Decode(out)
}
func (s *service) pancakeChannels() ([]PayChannelVO, error) {
	out := []PayChannelVO{}
	if !s.cfg.Pancake.Enabled || !s.cfg.Pancake.Configured() || s.cfg.Pancake.Validate(s.cfg.Env) != nil {
		return out, nil
	}
	rows, err := s.repo.enabledPayChannels()
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		if strings.EqualFold(strings.TrimSpace(row.Type), "pancake") {
			return []PayChannelVO{{Key: "pancake", Name: "Waffo Pancake", Currency: "USD"}}, nil
		}
	}
	return out, nil
}
func (s *service) createPancakeOrder(userID idgen.ID, dto CreateOrderDTO) (*OrderVO, error) {
	channels, err := s.pancakeChannels()
	if err != nil {
		return nil, err
	}
	if len(channels) == 0 {
		return nil, errUSDCheckoutUnavailable
	}
	if dto.Type != OrderTypePlan || (dto.Cycle != "" && dto.Cycle != CycleMonthly && dto.Cycle != CycleYearly) {
		return nil, errBadRequest
	}
	planID, err := idgen.Parse(dto.PlanID)
	if err != nil || planID == 0 {
		return nil, errBadRequest
	}
	cycle := dto.Cycle
	if cycle == "" {
		cycle = CycleMonthly
	}
	var order model.Order
	reused := false
	err = s.repo.db.Transaction(func(tx *gorm.DB) error {
		var buyer model.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&buyer, "id = ?", userID).Error; err != nil {
			return err
		}
		var plan model.Plan
		if err := tx.First(&plan, "id = ? AND market = ? AND currency = ? AND status = ?", planID, "en", "USD", 1).Error; err != nil {
			return ErrNotFound
		}
		prev := tx.Where("user_id = ? AND plan_id = ? AND market = ? AND currency = ? AND status = 0 AND payment_env = ? AND pay_method IN ?", userID, planID, "en", "USD", stripeMode(s.cfg.Env), []string{"stripe", "pancake"}).Order("id DESC").First(&order).Error
		if prev == nil {
			reused = true
			return nil
		}
		if !errors.Is(prev, gorm.ErrRecordNotFound) {
			return prev
		}
		pricing := *s
		pricing.repo = newRepo(tx)
		price, grant, err := pricing.effectivePlanPricing(&plan, cycle)
		if err != nil {
			return err
		}
		if _, err = stripeCents(price); err != nil || grant < 0 || buyer.Points > model.MaxBillingGrantPoints-int64(grant) {
			return errBadRequest
		}
		remaining := model.MaxBillingGrantPoints - buyer.Points - int64(grant)
		var pending []model.Order
		if err := tx.Select("purchase_snapshot").Where("user_id = ? AND status = 0 AND market = ? AND pay_method IN ?", userID, "en", []string{"stripe", "pancake"}).Find(&pending).Error; err != nil {
			return err
		}
		for _, p := range pending {
			var snap stripePurchase
			if json.Unmarshal([]byte(p.PurchaseSnapshot), &snap) != nil || !model.ValidBillingGrant(snap.Points, false) || int64(snap.Points) > remaining {
				return errBadRequest
			}
			remaining -= int64(snap.Points)
		}
		nonce := make([]byte, 32)
		if _, err := rand.Read(nonce); err != nil {
			return err
		}
		snap := pancakePurchase{stripePurchase: stripePurchase{Name: plan.Name, Points: grant, VIPLevel: vipForPlan(&plan), SiteURL: s.cfg.Pancake.SiteURL}, StoreID: s.cfg.Pancake.StoreID, ProductID: s.cfg.Pancake.ProductID, Nonce: hex.EncodeToString(nonce)}
		encoded, err := json.Marshal(snap)
		if err != nil {
			return err
		}
		expires := time.Now().UTC().Add(time.Hour)
		order = model.Order{BaseModel: model.BaseModel{ID: idgen.Next()}, OrderNo: genOrderNo(), UserID: userID, Market: "en", Currency: "USD", OrderType: OrderTypePlan, PlanID: &planID, Cycle: cycle, Amount: price, PayMethod: "pancake", PaymentEnv: stripeMode(s.cfg.Env), PurchaseSnapshot: string(encoded), CheckoutExpiresAt: &expires}
		return tx.Create(&order).Error
	})
	if err != nil {
		return nil, err
	}
	if order.PayMethod != "pancake" {
		vo, err := s.getOrder(order.ID, userID)
		if vo != nil {
			vo.ExistingCheckout = true
		}
		return vo, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	vo, err := s.resumePancakeCheckout(ctx, order.ID, userID)
	if vo != nil {
		vo.ExistingCheckout = reused
	}
	return vo, err
}
func (s *service) resumePancakeCheckout(ctx context.Context, id, userID idgen.ID) (*OrderVO, error) {
	o, err := s.repo.findOrder(id)
	if err != nil {
		return nil, err
	}
	if o.UserID != userID {
		return nil, errForbidden
	}
	if o.PayMethod != "pancake" || o.PaymentEnv != stripeMode(s.cfg.Env) {
		return nil, errBadRequest
	}
	channels, err := s.pancakeChannels()
	if err != nil {
		return nil, err
	}
	if len(channels) == 0 {
		return nil, errUSDCheckoutUnavailable
	}
	if o.Status != 0 {
		return s.getOrder(id, userID)
	}
	if o.CheckoutStartedAt != nil {
		if _, err := s.verifyPancakeOrder(ctx, o); err != nil {
			return nil, err
		}
		o, err = s.repo.findOrder(id)
		if err != nil {
			return nil, err
		}
		if o.Status != 0 || o.PaymentProcessing || o.CheckoutSessionID != nil {
			return s.getOrder(id, userID)
		}
	}
	if time.Until(orderDeadline(o)) < time.Minute {
		return s.getOrder(id, userID)
	}
	var snap pancakePurchase
	if json.Unmarshal([]byte(o.PurchaseSnapshot), &snap) != nil || snap.ProductID != s.cfg.Pancake.ProductID || snap.StoreID != s.cfg.Pancake.StoreID || snap.SiteURL != s.cfg.Pancake.SiteURL {
		return nil, errBadRequest
	}
	// Commit the attempt before calling the provider. An ambiguous network error
	// must not make this order cancelable or generate a new idempotency key.
	now := time.Now().UTC()
	attempt := s.repo.db.Model(o).Where("status = 0 AND checkout_started_at IS NULL").Update("checkout_started_at", now)
	if attempt.Error != nil {
		return nil, attempt.Error
	}
	if attempt.RowsAffected == 0 {
		latest, err := s.repo.findOrder(id)
		if err != nil {
			return nil, err
		}
		if latest.Status != 0 || latest.PaymentProcessing {
			return s.getOrder(id, userID)
		}
	}
	var buyer model.User
	if err := s.repo.db.First(&buyer, "id = ?", userID).Error; err != nil {
		return nil, err
	}
	body, _ := json.Marshal(map[string]any{"mode": o.PaymentEnv, "orderId": id.String(), "reference": pancakeRef(o.PaymentEnv, id), "buyerId": userID.String(), "email": buyer.Email, "amount": o.Amount.StringFixed(2), "nonce": snap.Nonce, "expiresAt": orderDeadline(o).Format(time.RFC3339), "storeId": snap.StoreID, "productId": snap.ProductID})
	var result struct {
		SessionID   string    `json:"sessionId"`
		CheckoutURL string    `json:"checkoutUrl"`
		ExpiresAt   time.Time `json:"expiresAt"`
	}
	if err := s.pancakeCall(ctx, "/checkout", body, "", &result); err != nil {
		return nil, err
	}
	if !strings.HasPrefix(result.SessionID, "cs_") || !safePancakeURL(result.CheckoutURL) || result.ExpiresAt.IsZero() {
		return nil, errBadRequest
	}
	// Conditional write avoids resurrecting checkout after a racing webhook.
	if err := s.repo.db.Model(o).Where("status = 0 AND payment_processing = ?", false).Updates(map[string]any{"checkout_session_id": result.SessionID, "checkout_url": result.CheckoutURL}).Error; err != nil {
		return nil, err
	}
	return s.getOrder(id, userID)
}
func (s *service) verifyPancakeOrder(ctx context.Context, o *model.Order, expected ...string) (*VerifyResult, error) {
	if o.PayMethod != "pancake" || o.PaymentEnv != stripeMode(s.cfg.Env) {
		return nil, errBadRequest
	}
	body, _ := json.Marshal(map[string]string{"mode": o.PaymentEnv, "reference": pancakeRef(o.PaymentEnv, o.ID)})
	var result struct {
		Orders []pancakeOrder `json:"orders"`
	}
	if err := s.pancakeCall(ctx, "/orders", body, "", &result); err != nil {
		return nil, err
	}
	if len(expected) > 0 {
		found := false
		for _, p := range result.Orders {
			if p.ProviderID == expected[0] && p.Paid {
				found = true
				if len(expected) > 1 && expected[1] != "" {
					found = false
					for _, ref := range p.RefundIDs {
						if ref == expected[1] {
							found = true
						}
					}
				}
			}
		}
		if !found {
			return nil, errPayUnavailable
		}
	}
	paidCount := 0
	for _, p := range result.Orders {
		if p.Paid {
			paidCount++
		}
	}
	if paidCount > 1 {
		return nil, fmt.Errorf("billing: multiple provider payments require reconciliation")
	}
	for _, p := range result.Orders {
		if p.Paid {
			return s.settlePancake(o.ID, p)
		}
	}
	for _, p := range result.Orders {
		if !s.pancakeMatches(o, p) {
			return nil, errBadRequest
		}
	}
	processing := false
	for _, p := range result.Orders {
		processing = processing || p.Processing
	}
	if processing {
		if err := s.repo.db.Model(o).Where("status = 0").Updates(map[string]any{"payment_processing": true, "checkout_url": ""}).Error; err != nil {
			return nil, err
		}
	}
	return &VerifyResult{Paid: o.Status == 1}, nil
}
func (s *service) pancakeMatches(o *model.Order, p pancakeOrder) bool {
	var snap pancakePurchase
	if json.Unmarshal([]byte(o.PurchaseSnapshot), &snap) != nil || len(snap.Nonce) != 64 {
		return false
	}
	return o.PayMethod == "pancake" && o.Market == "en" && model.OrderCurrency(o) == "USD" && p.Currency == "USD" &&
		p.Reference == pancakeRef(o.PaymentEnv, o.ID) && p.Mode == o.PaymentEnv && p.Mode == stripeMode(s.cfg.Env) &&
		p.StoreID == snap.StoreID && p.ProductID == snap.ProductID && p.Metadata["nonce"] == snap.Nonce &&
		p.Metadata["order_id"] == o.ID.String() && p.Metadata["buyer_id"] == o.UserID.String() &&
		p.Metadata["market"] == "en" && p.Metadata["environment"] == o.PaymentEnv &&
		strings.HasPrefix(p.ProviderID, "ORD_") && o.Amount.Equal(p.Subtotal) && p.Tax.GreaterThanOrEqual(decimal.Zero) &&
		p.Subtotal.Add(p.Tax).Equal(p.Total) && p.Total.GreaterThan(decimal.Zero) &&
		p.Subtotal.Equal(p.Subtotal.Round(2)) && p.Tax.Equal(p.Tax.Round(2)) && p.Refunded.Equal(p.Refunded.Round(2)) &&
		p.Refunded.GreaterThanOrEqual(decimal.Zero) && p.Refunded.LessThanOrEqual(p.Total)
}
func (s *service) settlePancake(id idgen.ID, p pancakeOrder) (*VerifyResult, error) {
	res := &VerifyResult{}
	err := s.repo.db.Transaction(func(tx *gorm.DB) error {
		var o model.Order
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&o, "id = ?", id).Error; err != nil {
			return err
		}
		if !p.Paid || !strings.HasPrefix(p.PaymentID, "PAY_") || !s.pancakeMatches(&o, p) || (o.PancakeProviderID != nil && *o.PancakeProviderID != p.ProviderID) {
			return errBadRequest
		}
		if o.Status == 3 {
			return nil
		}
		res.Paid = o.Status == 1
		var snap pancakePurchase
		if json.Unmarshal([]byte(o.PurchaseSnapshot), &snap) != nil || !model.ValidBillingGrant(snap.Points, false) {
			return errBadRequest
		}
		if o.Status == 0 || o.Status == 2 {
			var err error
			// Full refund before the original notification must never grant benefits.
			if !p.Refunded.Equal(p.Total) {
				res.Granted, err = newRepo(tx).settleOrder(o.ID, snap.Points, snap.VIPLevel, "Credit purchase: "+snap.Name, p.PaymentID, time.Now())
				if err != nil {
					return err
				}
			}
			o.Status = 1
		}
		if p.Refunded.LessThan(o.RefundedTotal) {
			return nil
		} // stale read after a newer refund
		target := decimal.NewFromInt(int64(snap.Points)).Mul(p.Refunded).Div(p.Total).Floor().IntPart()
		if !res.Granted && o.PayTime == nil && p.Refunded.Equal(p.Total) {
			target = int64(snap.Points)
		} else if target > o.RefundedPoints {
			if _, err := points.AdjustWhole(tx, o.UserID, -(target - o.RefundedPoints), "refund", "Pancake payment refund: "+o.OrderNo, o.ID); err != nil {
				return err
			}
		}
		status := 1
		if p.Refunded.Equal(p.Total) {
			status = 3
		}
		updates := map[string]any{"status": status, "pancake_provider_id": p.ProviderID, "transaction_id": p.PaymentID, "charged_total": p.Total, "tax_total": p.Tax, "refunded_total": p.Refunded, "refunded_points": target, "payment_processing": false, "checkout_url": ""}
		if o.PayTime == nil {
			updates["pay_time"] = time.Now()
		}
		if err := tx.Model(&o).Updates(updates).Error; err != nil {
			return err
		}
		res.Paid = status == 1
		return nil
	})
	return res, err
}
func (h *handler) pancakeWebhook(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1<<20)
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.Status(413)
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()
	var event struct {
		ID         string `json:"id"`
		EventID    string `json:"eventId"`
		Type       string `json:"type"`
		Reference  string `json:"reference"`
		ProviderID string `json:"providerId"`
	}
	if err = h.svc.pancakeCall(ctx, "/verify-webhook", body, c.GetHeader("X-Waffo-Signature"), &event); err != nil {
		if errors.Is(err, errBadRequest) {
			c.Status(400)
		} else {
			c.Status(503)
		}
		return
	}
	if event.Type != "order.completed" && event.Type != "refund.succeeded" {
		c.Status(200)
		return
	}
	prefix := "framelyn-" + stripeMode(h.svc.cfg.Env) + "-"
	if !strings.HasPrefix(event.Reference, prefix) {
		// Do not guess account ownership from email/price when provider metadata is
		// missing. Retain a failed delivery for reconciliation rather than miscredit.
		c.Status(422)
		return
	}
	id, err := idgen.Parse(strings.TrimPrefix(event.Reference, prefix))
	if err != nil {
		c.Status(422)
		return
	}
	o, err := h.svc.repo.findOrder(id)
	if err != nil {
		c.Status(503)
		return
	}
	refundID := ""
	if event.Type == "refund.succeeded" {
		refundID = event.EventID
	}
	_, err = h.svc.verifyPancakeOrder(ctx, o, event.ProviderID, refundID)
	if err != nil {
		c.Status(503)
		return
	}
	// Confirm only after the database commit, so provider retries recover outages.
	c.Status(200)
}
