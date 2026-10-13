package billing

import (
	"context"
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
	stripe "github.com/stripe/stripe-go/v87"
	"github.com/stripe/stripe-go/v87/webhook"
	"go.uber.org/zap"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/logger"
)

const stripeCheckoutTTL = time.Hour
const stripePreparationLead = 30*time.Minute + 30*time.Second

// Stripe requires new sessions to expire at least 30 minutes in the future.
// Leave room for network transit when deciding if an unissued session is usable.
func stripePreparationExpired(order *model.Order) bool {
	return order.CheckoutSessionID == nil && time.Now().After(orderDeadline(order).Add(-stripePreparationLead))
}

func stripePaymentFailed(session *stripe.CheckoutSession) bool {
	if session == nil || session.Status != stripe.CheckoutSessionStatusComplete || session.PaymentStatus != stripe.CheckoutSessionPaymentStatusUnpaid || session.PaymentIntent == nil {
		return false
	}
	return session.PaymentIntent.Status == stripe.PaymentIntentStatusCanceled || session.PaymentIntent.Status == stripe.PaymentIntentStatusRequiresPaymentMethod
}

func (s *service) retrieveStripeSession(ctx context.Context, id string) (*stripe.CheckoutSession, error) {
	return s.stripe.V1CheckoutSessions.Retrieve(ctx, id, &stripe.CheckoutSessionRetrieveParams{Expand: []*string{stripe.String("payment_intent")}})
}

// The snapshot is frozen before contacting Stripe. Replays use identical amounts,
// descriptions, URLs and expiry even after an administrator edits the plan/site.
type stripePurchase struct {
	Name     string `json:"name"`
	Points   int    `json:"points"`
	VIPLevel int    `json:"vipLevel"`
	SiteURL  string `json:"siteUrl"`
}

func (s *service) stripeConfigured() bool {
	return s.cfg.Stripe.SecretKey != "" && s.cfg.Stripe.WebhookSecret != "" && s.cfg.Stripe.SiteURL != "" && s.cfg.Stripe.Validate(s.cfg.Env) == nil
}

func (s *service) stripeChannels() ([]PayChannelVO, error) {
	out := []PayChannelVO{}
	if !s.cfg.Stripe.Enabled || !s.stripeConfigured() {
		return out, nil
	}
	rows, err := s.repo.enabledPayChannels()
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		if strings.EqualFold(strings.TrimSpace(row.Type), "stripe") {
			return []PayChannelVO{{Key: "stripe", Name: "Stripe", Currency: model.CurrencyUSD}}, nil
		}
	}
	return out, nil
}

func stripeMode(env string) string {
	if env == "prod" {
		return "prod"
	}
	return "test"
}

func orderDeadline(o *model.Order) time.Time {
	if (o.PayMethod == "stripe" || o.PayMethod == "pancake") && o.CheckoutExpiresAt != nil {
		return *o.CheckoutExpiresAt
	}
	return payDeadline(o.CreateTime)
}

func stripeCents(amount decimal.Decimal) (int64, error) {
	cents := amount.Mul(decimal.NewFromInt(100))
	// USD card payments require at least $0.50; Stripe accepts at most eight digits.
	if !cents.Equal(cents.Truncate(0)) || cents.LessThan(decimal.NewFromInt(50)) || cents.GreaterThan(decimal.NewFromInt(99999999)) {
		return 0, errBadRequest
	}
	return cents.IntPart(), nil
}

func (s *service) createStripeOrder(userID idgen.ID, dto CreateOrderDTO) (*OrderVO, error) {
	channels, err := s.stripeChannels()
	if err != nil {
		return nil, err
	}
	if len(channels) == 0 {
		return nil, errUSDCheckoutUnavailable
	}
	if dto.PayChannel != "" && dto.PayChannel != "stripe" {
		return nil, errChannelDisabled
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
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()
	var order model.Order
	reused := false
	// Serialize purchases by buyer across server instances. Durable pending orders
	// survive API timeouts and are resumed with the same Stripe idempotency key.
	err = s.repo.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var buyer model.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&buyer, "id = ?", userID).Error; err != nil {
			return err
		}
		var plan model.Plan
		if err := tx.First(&plan, "id = ? AND market = ? AND currency = ? AND status = ?", planID, "en", "USD", 1).Error; err != nil {
			return ErrNotFound
		}
		vip := vipForPlan(&plan)
		// English purchases replenish credits. Membership is upgraded only when
		// higher, by settleOrder; an existing tier must not prevent a top-up.
		// A completed checkout can still have a delayed payment in flight. Only
		// Stripe-confirmed expiry/failure releases a known session for repurchase.
		prev := tx.Where("user_id = ? AND plan_id = ? AND market = ? AND currency = ? AND pay_method IN ? AND payment_env = ? AND status = 0", userID, planID, "en", "USD", []string{"stripe", "pancake"}, stripeMode(s.cfg.Env)).Order("id DESC").First(&order).Error
		if prev == nil {
			reused = true
			return nil
		}
		if !errors.Is(prev, gorm.ErrRecordNotFound) {
			return prev
		}
		pricing := *s
		pricing.repo = newRepo(tx)
		price, points, err := pricing.effectivePlanPricing(&plan, cycle)
		if err != nil {
			return err
		}
		if _, err := stripeCents(price); err != nil || points < 0 {
			return errBadRequest
		}
		if points > 0 && buyer.Points > model.MaxBillingGrantPoints-int64(points) {
			return errBadRequest
		}
		// Capacity is checked under the buyer lock across different plans, too.
		// Reserving incoming capacity does not freeze any spendable user balance.
		if points > 0 {
			remaining := model.MaxBillingGrantPoints - buyer.Points - int64(points)
			var pending []model.Order
			if err := tx.Select("purchase_snapshot").Where("user_id = ? AND market = ? AND currency = ? AND pay_method IN ? AND payment_env = ? AND status = 0", userID, "en", "USD", []string{"stripe", "pancake"}, stripeMode(s.cfg.Env)).Find(&pending).Error; err != nil {
				return err
			}
			for _, item := range pending {
				var grant stripePurchase
				if json.Unmarshal([]byte(item.PurchaseSnapshot), &grant) != nil || !model.ValidBillingGrant(grant.Points, false) || int64(grant.Points) > remaining {
					return errBadRequest
				}
				remaining -= int64(grant.Points)
			}
		}
		snapshot, err := json.Marshal(stripePurchase{Name: plan.Name, Points: points, VIPLevel: vip, SiteURL: strings.TrimRight(s.cfg.Stripe.SiteURL, "/")})
		if err != nil {
			return err
		}
		expires := time.Now().UTC().Add(stripeCheckoutTTL).Truncate(time.Second)
		order = model.Order{BaseModel: model.BaseModel{ID: idgen.Next()}, OrderNo: genOrderNo(), UserID: userID, Market: "en", Currency: "USD", OrderType: OrderTypePlan, PlanID: &planID, Cycle: cycle, Amount: price, PayMethod: "stripe", PaymentEnv: stripeMode(s.cfg.Env), PurchaseSnapshot: string(snapshot), CheckoutExpiresAt: &expires}
		return tx.Create(&order).Error
	})
	if err != nil {
		return nil, err
	}
	if order.PayMethod == "pancake" {
		vo, err := s.getOrder(order.ID, userID)
		if vo != nil {
			vo.ExistingCheckout = true
		}
		return vo, err
	}
	vo, err := s.resumeStripeCheckout(ctx, order.ID, userID)
	if err == nil {
		vo.ExistingCheckout = reused
	}
	return vo, err
}

func (s *service) stripeSession(ctx context.Context, order *model.Order) (*stripe.CheckoutSession, error) {
	if !s.stripeConfigured() {
		return nil, errUSDCheckoutUnavailable
	}
	if order.PaymentEnv != stripeMode(s.cfg.Env) {
		return nil, errBadRequest
	}
	if order.CheckoutSessionID != nil {
		return s.retrieveStripeSession(ctx, *order.CheckoutSessionID)
	}
	var purchase stripePurchase
	if json.Unmarshal([]byte(order.PurchaseSnapshot), &purchase) != nil || purchase.Name == "" || order.CheckoutExpiresAt == nil {
		return nil, errBadRequest
	}
	cents, err := stripeCents(order.Amount)
	if err != nil {
		return nil, err
	}
	meta := map[string]string{"order_id": order.ID.String(), "order_no": order.OrderNo, "market": "en", "environment": order.PaymentEnv}
	params := &stripe.CheckoutSessionCreateParams{
		AdaptivePricing: &stripe.CheckoutSessionCreateAdaptivePricingParams{Enabled: stripe.Bool(false)},
		Mode:            stripe.String("payment"), Locale: stripe.String("en"), ClientReferenceID: stripe.String(order.ID.String()),
		SuccessURL: stripe.String(purchase.SiteURL + "/billing?order=" + order.ID.String() + "&checkout=success"),
		CancelURL:  stripe.String(purchase.SiteURL + "/billing?order=" + order.ID.String() + "&checkout=cancelled"),
		ExpiresAt:  stripe.Int64(order.CheckoutExpiresAt.Unix()), Metadata: meta,
		PaymentIntentData: &stripe.CheckoutSessionCreatePaymentIntentDataParams{Metadata: meta},
		LineItems: []*stripe.CheckoutSessionCreateLineItemParams{{Quantity: stripe.Int64(1), PriceData: &stripe.CheckoutSessionCreateLineItemPriceDataParams{
			Currency: stripe.String("usd"), UnitAmount: stripe.Int64(cents), ProductData: &stripe.CheckoutSessionCreateLineItemPriceDataProductDataParams{
				Name: stripe.String(purchase.Name), Description: stripe.String(fmt.Sprintf("%s purchase · %d credits · One-time payment, no automatic renewal", order.Cycle, purchase.Points)),
			},
		}}},
	}
	params.SetIdempotencyKey("framelyn-checkout-" + order.PaymentEnv + "-" + order.OrderNo)
	return s.stripe.V1CheckoutSessions.Create(ctx, params)
}

func (s *service) stripeMatches(order *model.Order, session *stripe.CheckoutSession) bool {
	if session == nil || session.ID == "" || order.PayMethod != "stripe" || order.Market != "en" || order.Currency != "USD" || order.PaymentEnv != stripeMode(s.cfg.Env) {
		return false
	}
	if session.Livemode != (order.PaymentEnv == "prod") || session.Mode != stripe.CheckoutSessionModePayment || session.Currency != stripe.CurrencyUSD {
		return false
	}
	if order.CheckoutSessionID != nil && *order.CheckoutSessionID != session.ID {
		return false
	}
	if session.ClientReferenceID != order.ID.String() || session.Metadata["order_id"] != order.ID.String() || session.Metadata["order_no"] != order.OrderNo || session.Metadata["market"] != "en" || session.Metadata["environment"] != order.PaymentEnv {
		return false
	}
	cents, err := stripeCents(order.Amount)
	return err == nil && session.AmountTotal == cents
}

func safeStripeURL(raw string) bool {
	u, err := url.Parse(raw)
	return err == nil && u.Scheme == "https" && u.Host == "checkout.stripe.com" && u.User == nil
}

// Holding the order lock also serializes concurrent resume/cancel/webhook calls.
func (s *service) resumeStripeCheckout(ctx context.Context, id, userID idgen.ID) (*OrderVO, error) {
	var order model.Order
	var checked *stripe.CheckoutSession
	err := s.repo.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&order, "id = ?", id).Error; err != nil {
			return err
		}
		if order.UserID != userID {
			return errForbidden
		}
		if order.Status != 0 {
			return errBadRequest
		}
		if stripePreparationExpired(&order) {
			// No URL was ever handed to the buyer; do not create an already-expired
			// checkout. Unknown attempts used the same fixed Stripe expiry.
			order.Status = 2
			return tx.Model(&order).Updates(map[string]any{"status": 2, "checkout_url": ""}).Error
		}
		session, err := s.stripeSession(ctx, &order)
		if err != nil {
			return errPayUnavailable
		}
		if !s.stripeMatches(&order, session) {
			return errBadRequest
		}
		checked = session
		order.CheckoutSessionID = &session.ID
		order.CheckoutURL = ""
		if session.Status == stripe.CheckoutSessionStatusComplete && session.PaymentStatus == stripe.CheckoutSessionPaymentStatusUnpaid {
			order.PaymentProcessing = true
		}
		if session.Status == stripe.CheckoutSessionStatusOpen && !order.PaymentProcessing && time.Now().Before(orderDeadline(&order)) && safeStripeURL(session.URL) {
			order.CheckoutURL = session.URL
		}
		if session.Status == stripe.CheckoutSessionStatusExpired || stripePaymentFailed(session) {
			order.Status = 2
			order.PaymentProcessing = false
		}
		return tx.Model(&order).Updates(map[string]any{"checkout_session_id": session.ID, "checkout_url": order.CheckoutURL, "status": order.Status, "payment_processing": order.PaymentProcessing}).Error
	})
	if err != nil {
		return nil, err
	}
	if checked != nil && checked.PaymentStatus == stripe.CheckoutSessionPaymentStatusPaid {
		if _, err := s.settleStripeSession(ctx, checked); err != nil {
			return nil, err
		}
		fresh, err := s.repo.findOrder(order.ID)
		if err != nil {
			return nil, err
		}
		order = *fresh
	}
	vo := toOrderVO(&order)
	if order.Status == 0 && !order.PaymentProcessing {
		vo.PayURL = order.CheckoutURL
	}
	return &vo, nil
}

func (s *service) settleStripeSession(ctx context.Context, session *stripe.CheckoutSession) (*VerifyResult, error) {
	if session == nil {
		return nil, errBadRequest
	}
	var order model.Order
	id, err := idgen.Parse(session.ClientReferenceID)
	if err != nil {
		return nil, errBadRequest
	}
	// A successful webhook can beat the response which stores the session ID.
	err = s.repo.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&order, "id = ?", id).Error; err != nil {
			return err
		}
		if !s.stripeMatches(&order, session) {
			return errBadRequest
		}
		updates := map[string]any{}
		if order.CheckoutSessionID == nil {
			order.CheckoutSessionID = &session.ID
			updates["checkout_session_id"] = session.ID
		}
		if order.Status == 0 {
			if session.Status == stripe.CheckoutSessionStatusComplete && session.PaymentStatus == stripe.CheckoutSessionPaymentStatusUnpaid {
				updates["payment_processing"] = true
				updates["checkout_url"] = ""
			}
			if session.Status == stripe.CheckoutSessionStatusExpired || stripePaymentFailed(session) {
				updates["status"] = 2
				updates["payment_processing"] = false
				updates["checkout_url"] = ""
			}
		}
		if len(updates) > 0 {
			return tx.Model(&order).Updates(updates).Error
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if order.Status == 3 {
		return &VerifyResult{}, nil
	}
	if session.PaymentStatus != stripe.CheckoutSessionPaymentStatusPaid || session.Status != stripe.CheckoutSessionStatusComplete {
		return &VerifyResult{}, nil
	}
	if session.PaymentIntent == nil || session.PaymentIntent.ID == "" {
		return nil, errBadRequest
	}
	var purchase stripePurchase
	if json.Unmarshal([]byte(order.PurchaseSnapshot), &purchase) != nil || purchase.Points < 0 || purchase.Name == "" {
		return nil, errBadRequest
	}
	granted, err := s.repo.settleOrder(order.ID, purchase.Points, purchase.VIPLevel, "Stripe purchase: "+purchase.Name, session.PaymentIntent.ID, time.Now())
	if err != nil {
		return nil, err
	}
	// Another worker can refund an already-paid order between validation and the
	// conditional settlement. RowsAffected=0 alone does not mean it is paid.
	stored, err := s.repo.findOrder(order.ID)
	if err != nil {
		return nil, err
	}
	return &VerifyResult{Paid: stored.Status == 1, Granted: granted}, nil
}

func (s *service) verifyStripeOrder(ctx context.Context, order *model.Order) (*VerifyResult, error) {
	if order.Status == 1 {
		return &VerifyResult{Paid: true}, nil
	}
	if order.Status == 3 {
		return &VerifyResult{}, nil
	}
	if order.CheckoutSessionID == nil {
		// Recover only while pending: never create a session for a cancelled order.
		if order.Status != 0 || time.Now().After(orderDeadline(order)) {
			return &VerifyResult{}, nil
		}
		if _, err := s.resumeStripeCheckout(ctx, order.ID, order.UserID); err != nil {
			return nil, err
		}
		fresh, err := s.repo.findOrder(order.ID)
		if err != nil {
			return nil, err
		}
		order = fresh
	}
	session, err := s.stripeSession(ctx, order)
	if err != nil {
		return nil, errPayUnavailable
	}
	return s.settleStripeSession(ctx, session)
}

func (s *service) cancelStripeOrder(ctx context.Context, id, userID idgen.ID) error {
	return s.repo.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var order model.Order
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&order, "id = ?", id).Error; err != nil {
			return err
		}
		if order.UserID != userID {
			return errForbidden
		}
		if order.Status != 0 {
			return errBadRequest
		}
		// With no persisted session ID, no payment URL has been handed to the
		// buyer. The order lock serializes against issuance. Never CREATE on cancel.
		if order.CheckoutSessionID == nil {
			return tx.Model(&order).Updates(map[string]any{"status": 2, "checkout_url": "", "payment_processing": false}).Error
		}
		session, err := s.stripeSession(ctx, &order)
		if err != nil {
			return errPayUnavailable
		}
		if !s.stripeMatches(&order, session) || (session.Status == stripe.CheckoutSessionStatusComplete && !stripePaymentFailed(session)) {
			return errBadRequest
		}
		if session.Status == stripe.CheckoutSessionStatusOpen {
			session, err = s.stripe.V1CheckoutSessions.Expire(ctx, session.ID, nil)
			if err != nil {
				return errPayUnavailable
			}
		}
		if !s.stripeMatches(&order, session) || (session.Status != stripe.CheckoutSessionStatusExpired && !stripePaymentFailed(session)) {
			return errBadRequest
		}
		return tx.Model(&order).Updates(map[string]any{"status": 2, "checkout_session_id": session.ID, "checkout_url": ""}).Error
	})
}

func (h *handler) stripeWebhook(c *gin.Context) {
	if !h.svc.stripeConfigured() {
		c.Status(http.StatusServiceUnavailable)
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 1<<20)
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.Status(http.StatusRequestEntityTooLarge)
		return
	}
	event, err := webhook.ConstructEvent(body, c.GetHeader("Stripe-Signature"), h.svc.cfg.Stripe.WebhookSecret)
	if err != nil {
		c.Status(http.StatusBadRequest)
		return
	}
	if event.Livemode != h.svc.cfg.IsProd() {
		c.Status(http.StatusBadRequest)
		return
	}
	switch event.Type {
	case stripe.EventTypeCheckoutSessionCompleted, stripe.EventTypeCheckoutSessionAsyncPaymentSucceeded, stripe.EventTypeCheckoutSessionExpired, stripe.EventTypeCheckoutSessionAsyncPaymentFailed:
	default:
		c.Status(http.StatusOK)
		return
	}
	if event.Data == nil {
		c.Status(http.StatusBadRequest)
		return
	}
	var payload stripe.CheckoutSession
	if json.Unmarshal(event.Data.Raw, &payload) != nil || payload.ID == "" {
		c.Status(http.StatusBadRequest)
		return
	}
	// Ignore other applications sharing this Stripe account.
	if payload.Metadata["market"] != "en" || payload.Metadata["order_id"] == "" {
		c.Status(http.StatusOK)
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 20*time.Second)
	defer cancel()
	session, err := h.svc.retrieveStripeSession(ctx, payload.ID)
	if err == nil {
		_, err = h.svc.settleStripeSession(ctx, session)
		if err == nil && (session.Status == stripe.CheckoutSessionStatusExpired || (event.Type == stripe.EventTypeCheckoutSessionAsyncPaymentFailed && session.PaymentStatus == stripe.CheckoutSessionPaymentStatusUnpaid)) {
			id, _ := idgen.Parse(session.ClientReferenceID)
			err = h.svc.repo.cancelExpiredByID(id)
		}
	}
	if err != nil {
		logger.L().Warn("billing: Stripe event processing failed", zap.String("eventID", event.ID))
		c.Status(http.StatusInternalServerError) // Stripe retries; no premature acknowledgment.
		return
	}
	c.Status(http.StatusOK)
}
