package billing

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
	stripe "github.com/stripe/stripe-go/v87"
	"github.com/stripe/stripe-go/v87/webhook"
	mysqldialect "gorm.io/driver/mysql"
	"gorm.io/gorm"
	"gorm.io/gorm/schema"
	"tidecanvas/internal/config"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

type stripeFixture struct {
	t           *testing.T
	mu          sync.Mutex
	sessions    map[string]*stripe.CheckoutSession
	keys        map[string]string
	forms       []url.Values
	keysUsed    []string
	failNext    bool
	checkExpiry bool
	reads       int
}

func TestBillingActualMySQLCreditColumnTypes(t *testing.T) {
	dialect := mysqldialect.Dialector{}
	for _, entry := range []struct {
		value any
		field string
	}{{&model.PointRecord{}, "Amount"}, {&model.PointRecord{}, "Balance"}, {&model.Plan{}, "PointsGrant"}} {
		parsed, err := schema.Parse(entry.value, &sync.Map{}, schema.NamingStrategy{})
		if err != nil {
			t.Fatal(err)
		}
		actual := dialect.DataTypeOf(parsed.LookUpField(entry.field))
		t.Logf("%s: %s", entry.field, actual)
		if actual != "bigint" {
			t.Fatalf("Unexpected production dialect type: %s", actual)
		}
	}
	if !model.ValidBillingGrant(300000000, true) {
		t.Fatal("Valid BIGINT annual grant was rejected by an assumed INT32 limit")
	}
}

func (f *stripeFixture) serve(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	if r.Method == "POST" && r.URL.Path == "/v1/checkout/sessions" {
		_ = r.ParseForm()
		f.forms = append(f.forms, r.PostForm)
		key := r.Header.Get("Idempotency-Key")
		f.keysUsed = append(f.keysUsed, key)
		if key == "" {
			f.t.Error("Missing Stripe idempotency key")
		}
		id := f.keys[key]
		if id == "" {
			expiry, _ := strconv.ParseInt(r.Form.Get("expires_at"), 10, 64)
			if f.checkExpiry && expiry < time.Now().Add(30*time.Minute).Unix() {
				w.WriteHeader(400)
				_, _ = w.Write([]byte(`{"error":{"type":"invalid_request_error","param":"expires_at","message":"Expiry is too soon"}}`))
				return
			}
			id = fmt.Sprintf("cs_test_%d", len(f.sessions)+1)
			f.keys[key] = id
			amount, _ := strconv.ParseInt(r.Form.Get("line_items[0][price_data][unit_amount]"), 10, 64)
			expires, _ := strconv.ParseInt(r.Form.Get("expires_at"), 10, 64)
			meta := map[string]string{}
			for _, name := range []string{"order_id", "order_no", "market", "environment"} {
				meta[name] = r.Form.Get("metadata[" + name + "]")
			}
			f.sessions[id] = &stripe.CheckoutSession{ID: id, Mode: stripe.CheckoutSessionModePayment, Status: stripe.CheckoutSessionStatusOpen, PaymentStatus: stripe.CheckoutSessionPaymentStatusUnpaid, Currency: stripe.CurrencyUSD, AmountTotal: amount, ClientReferenceID: r.Form.Get("client_reference_id"), Metadata: meta, ExpiresAt: expires, URL: "https://checkout.stripe.com/c/pay/" + id}
		}
		if f.failNext {
			f.failNext = false
			// Lose the successful response at the network layer. A Stripe v1 HTTP
			// 500 is cached for this key, so returning 500 then 200 is not realistic.
			connection, _, err := w.(http.Hijacker).Hijack()
			if err != nil {
				f.t.Error(err)
				return
			}
			_ = connection.Close()
			return
		}
		_ = json.NewEncoder(w).Encode(f.sessions[id])
		return
	}
	id := strings.TrimPrefix(r.URL.Path, "/v1/checkout/sessions/")
	expiring := strings.HasSuffix(id, "/expire")
	id = strings.TrimSuffix(id, "/expire")
	session := f.sessions[id]
	if session == nil {
		w.WriteHeader(404)
		return
	}
	if expiring {
		session.Status = stripe.CheckoutSessionStatusExpired
		session.URL = ""
	} else {
		f.reads++
		query := r.URL.Query()
		if session.PaymentIntent != nil && query.Get("expand[0]") != "payment_intent" && query.Get("expand[]") != "payment_intent" {
			copy := *session
			copy.PaymentIntent = &stripe.PaymentIntent{ID: session.PaymentIntent.ID}
			_ = json.NewEncoder(w).Encode(&copy)
			return
		}
	}
	_ = json.NewEncoder(w).Encode(session)
}

func TestStripeCancelUnissuedOrderDoesNotCreateCheckout(t *testing.T) {
	s, f, _ := setupStripe(t)
	expires := time.Now().UTC().Add(20 * time.Minute)
	snapshot, _ := json.Marshal(stripePurchase{Name: "Creator", Points: 600, VIPLevel: 1, SiteURL: s.cfg.Stripe.SiteURL})
	order := model.Order{BaseModel: model.BaseModel{ID: idgen.Next()}, OrderNo: genOrderNo(), UserID: 701, Market: "en", Currency: "USD", OrderType: "plan", PayMethod: "stripe", PaymentEnv: "test", Amount: decimal.NewFromInt(12), PurchaseSnapshot: string(snapshot), CheckoutExpiresAt: &expires}
	if err := s.repo.createOrder(&order); err != nil {
		t.Fatal(err)
	}
	f.checkExpiry = true
	if err := s.cancelOrder(order.ID, 701); err != nil {
		t.Fatalf("Unissued order cannot be cancelled: %v", err)
	}
	if len(f.forms) != 0 {
		t.Fatal("Cancelling an unissued order created a Stripe checkout")
	}
	stored, _ := s.repo.findOrder(order.ID)
	if stored.Status != 2 {
		t.Fatal("Order remained pending")
	}
}

func TestStripeLateUnissuedCheckoutExitsUnusablePreparationWindow(t *testing.T) {
	s, f, _ := setupStripe(t)
	expires := time.Now().UTC().Add(20 * time.Minute)
	snapshot, _ := json.Marshal(stripePurchase{Name: "Creator", Points: 600, VIPLevel: 1, SiteURL: s.cfg.Stripe.SiteURL})
	order := model.Order{BaseModel: model.BaseModel{ID: idgen.Next()}, OrderNo: genOrderNo(), UserID: 701, Market: "en", Currency: "USD", OrderType: "plan", PayMethod: "stripe", PaymentEnv: "test", Amount: decimal.NewFromInt(12), PurchaseSnapshot: string(snapshot), CheckoutExpiresAt: &expires}
	if err := s.repo.createOrder(&order); err != nil {
		t.Fatal(err)
	}
	f.checkExpiry = true
	vo, err := s.resumeStripeCheckout(context.Background(), order.ID, 701)
	if err != nil || vo.Status != 2 || vo.PayURL != "" {
		t.Fatalf("Invalid expires_at was retried indefinitely: %+v %v", vo, err)
	}
	if len(f.forms) != 0 {
		t.Fatal("Submitted an impossible Stripe expiry")
	}
}

func TestStripeUnissuedPreparationDeadlineIsHonest(t *testing.T) {
	s, _, _ := setupStripe(t)
	expires := time.Now().UTC().Add(time.Hour)
	order := model.Order{BaseModel: model.BaseModel{ID: idgen.Next()}, OrderNo: genOrderNo(), UserID: 701, Market: "en", Currency: "USD", OrderType: "plan", PayMethod: "stripe", PaymentEnv: "test", Amount: decimal.NewFromInt(12), CheckoutExpiresAt: &expires}
	if err := s.repo.createOrder(&order); err != nil {
		t.Fatal(err)
	}
	view, err := s.getOrder(order.ID, 701)
	if err != nil || view.PrepareBefore == nil || view.ExpireTime != nil {
		t.Fatalf("Unissued checkout used wrong deadline: %+v %v", view, err)
	}
	s.repo.db.Model(&order).Update("checkout_expires_at", time.Now().UTC().Add(20*time.Minute))
	if err := s.repo.cancelExpiredOrders(701, time.Now().Add(-payTTL)); err != nil {
		t.Fatal(err)
	}
	stored, _ := s.repo.findOrder(order.ID)
	if stored.Status != 2 {
		t.Fatal("Orders list retained an unpreparable checkout")
	}
}

func TestStripeVerifyRecoversMissedAsyncFailure(t *testing.T) {
	s, f, dto := setupStripe(t)
	vo, err := s.createOrder(701, dto, "en")
	if err != nil {
		t.Fatal(err)
	}
	session := f.sessions["cs_test_1"]
	session.Status = stripe.CheckoutSessionStatusComplete
	session.PaymentStatus = stripe.CheckoutSessionPaymentStatusUnpaid
	session.PaymentIntent = &stripe.PaymentIntent{ID: "pi_declined", Status: stripe.PaymentIntentStatusRequiresPaymentMethod}
	result, err := s.verifyOrder(context.Background(), 701, vo.OrderNo)
	if err != nil || result.Paid {
		t.Fatalf("Failed payment result incorrect: %+v %v", result, err)
	}
	stored, _ := s.repo.findOrder(vo.ID)
	if stored.Status != 2 || stored.PaymentProcessing {
		t.Fatal("A failed payment with a missed webhook stayed processing forever")
	}
}

func TestStripeRechargePreservesPreciseBalanceAndReservations(t *testing.T) {
	s, f, dto := setupStripe(t)
	fraction := model.PointScale / 4
	held := model.PointScale * 2
	if err := s.repo.db.Model(&model.User{}).Where("id = 701").Updates(map[string]any{"point_fraction": fraction, "point_held_micros": held}).Error; err != nil {
		t.Fatal(err)
	}
	vo, err := s.createOrder(701, dto, "en")
	if err != nil {
		t.Fatal(err)
	}
	paidSession(f, "cs_test_1")
	if _, err := s.verifyOrder(context.Background(), 701, vo.OrderNo); err != nil {
		t.Fatal(err)
	}
	var user model.User
	s.repo.db.First(&user, "id = 701")
	if user.Points != 610 || user.PointFraction != fraction || user.PointHeldMicros != held {
		t.Fatal("Recharge changed fractional or reserved credits")
	}
	var record model.PointRecord
	s.repo.db.Where("ref_id = ?", vo.ID).First(&record)
	if record.AmountMicros == nil || *record.AmountMicros != 600*model.PointScale || record.BalanceMicros == nil || *record.BalanceMicros != 610*model.PointScale+fraction {
		t.Fatal("Recharge ledger dropped the fractional balance snapshot")
	}
}

func TestStripePendingPurchasesReserveCreditCapacity(t *testing.T) {
	s, f, dto := setupStripe(t)
	s.repo.db.Model(&model.User{}).Where("id = 701").Update("points", model.MaxBillingGrantPoints-1000)
	other := model.Plan{BaseModel: model.BaseModel{ID: 803}, Market: "en", Currency: "USD", Code: "en_other", Name: "Other plan", Price: decimal.NewFromInt(12), PointsGrant: 600, Status: 1, Features: `{"vipLevel":2}`}
	if err := s.repo.db.Create(&other).Error; err != nil {
		t.Fatal(err)
	}
	first, err := s.createOrder(701, dto, "en")
	if err != nil {
		t.Fatal(err)
	}
	dto.PlanID = "803"
	if _, err := s.createOrder(701, dto, "en"); !errors.Is(err, errBadRequest) {
		t.Fatalf("Combined pending grants exceed representable balance: %v", err)
	}
	if len(f.sessions) != 1 {
		t.Fatal("Unfulfillable purchase reached Stripe")
	}
	if err := s.cancelOrder(first.ID, 701); err != nil {
		t.Fatal(err)
	}
	if _, err := s.createOrder(701, dto, "en"); err != nil {
		t.Fatalf("Confirmed cancellation did not release capacity: %v", err)
	}
}

func TestBillingClosedOrderIsNotAServerFailure(t *testing.T) {
	gin.SetMode(gin.TestMode)
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	(&handler{}).fail(c, errBadRequest, "failed to cancel order")
	if rec.Code != 400 {
		t.Fatalf("Business state rejection reported as HTTP %d", rec.Code)
	}
}

func setupStripe(t *testing.T) (*service, *stripeFixture, CreateOrderDTO) {
	t.Helper()
	db := marketTestDB(t)
	if err := db.AutoMigrate(&model.PointRecord{}); err != nil {
		t.Fatal(err)
	}
	sql, _ := db.DB()
	sql.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sql.Close() })
	for _, row := range []any{
		&model.User{ID: 701, Username: "stripe-buyer", Email: "buyer@example.test", Points: 10},
		&model.User{ID: 702, Username: "other-buyer", Email: "other@example.test", Points: 10},
		&model.Plan{BaseModel: model.BaseModel{ID: 801}, Market: "en", Currency: "USD", Code: "en_stripe", Name: "Creator", Price: decimal.RequireFromString("12.50"), PointsGrant: 600, Status: 1, Features: `{"yearly":120,"vipLevel":1}`},
		&model.Plan{BaseModel: model.BaseModel{ID: 802}, Code: "cn_stripe", Name: "CN", Price: decimal.NewFromInt(60), PointsGrant: 600, Status: 1},
		&model.PayChannel{Type: "stripe", Name: "Stripe", Enabled: true},
		&model.PayChannel{Type: "alipay", Name: "Alipay", Enabled: true},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	cfg := &config.Config{Env: "test", Stripe: config.StripeConfig{Enabled: true, SecretKey: "sk_test_fixture", WebhookSecret: "whsec_fixture", SiteURL: "https://test-framelyn.tcmzhan.com"}}
	s := newService(db, cfg)
	fixture := &stripeFixture{t: t, sessions: map[string]*stripe.CheckoutSession{}, keys: map[string]string{}}
	server := httptest.NewServer(http.HandlerFunc(fixture.serve))
	t.Cleanup(server.Close)
	backends := stripe.NewBackendsWithConfig(&stripe.BackendConfig{URL: stripe.String(server.URL), HTTPClient: server.Client(), MaxNetworkRetries: stripe.Int64(0), LeveledLogger: &stripe.LeveledLogger{Level: stripe.LevelNull}})
	s.stripe = stripe.NewClient(cfg.Stripe.SecretKey, stripe.WithBackends(backends))
	return s, fixture, CreateOrderDTO{Type: "plan", PlanID: "801", PayChannel: "stripe", Cycle: "monthly"}
}

func paidSession(f *stripeFixture, id string) *stripe.CheckoutSession {
	f.mu.Lock()
	defer f.mu.Unlock()
	session := f.sessions[id]
	session.Status = stripe.CheckoutSessionStatusComplete
	session.PaymentStatus = stripe.CheckoutSessionPaymentStatusPaid
	session.PaymentIntent = &stripe.PaymentIntent{ID: "pi_" + id}
	return session
}

func TestStripeCheckoutRecoveryAndSnapshot(t *testing.T) {
	s, f, dto := setupStripe(t)
	f.failNext = true
	if _, err := s.createOrder(701, dto, "en"); !errors.Is(err, errPayUnavailable) {
		t.Fatalf("Expected ambiguous gateway failure: %v", err)
	}
	vo, err := s.createOrder(701, dto, "en")
	if err != nil {
		t.Fatal(err)
	}
	if vo.Currency != "USD" || vo.Amount != 12.5 || vo.PayURL == "" || vo.Credits == nil || *vo.Credits != 600 {
		t.Fatalf("Wrong order: %+v", vo)
	}
	var count int64
	s.repo.db.Model(&model.Order{}).Count(&count)
	if count != 1 || len(f.sessions) != 1 || f.keysUsed[0] != f.keysUsed[1] {
		t.Fatal("Retry created duplicate checkout")
	}
	if f.forms[0].Encode() != f.forms[1].Encode() {
		t.Fatal("Retry changed Stripe parameters")
	}
	if f.forms[0].Get("mode") != "payment" || f.forms[0].Get("line_items[0][price_data][unit_amount]") != "1250" || !strings.HasPrefix(f.forms[0].Get("success_url"), "https://test-framelyn.tcmzhan.com/billing?order=") {
		t.Fatal("Checkout contract incorrect")
	}
	if err := s.repo.db.Model(&model.Plan{}).Where("id = 801").Updates(map[string]any{"price": 99, "points_grant": 9000, "status": 0}).Error; err != nil {
		t.Fatal(err)
	}
	paidSession(f, "cs_test_1")
	for i := 0; i < 2; i++ {
		r, err := s.verifyOrder(context.Background(), 701, vo.OrderNo)
		if err != nil || !r.Paid || r.Granted != (i == 0) {
			t.Fatalf("Settlement %d: %+v %v", i, r, err)
		}
	}
	var buyer model.User
	s.repo.db.First(&buyer, "id = 701")
	if buyer.Points != 610 || buyer.VipLevel != 1 {
		t.Fatalf("Snapshot not honored: %+v", buyer)
	}
	s.repo.db.Model(&model.PointRecord{}).Count(&count)
	if count != 1 {
		t.Fatal("Duplicate credit ledger entry")
	}
}

func TestStripePurchaseGatesAndCurrency(t *testing.T) {
	s, _, dto := setupStripe(t)
	channels, err := s.listPayChannels("en")
	if err != nil || len(channels) != 1 || channels[0].Key != "stripe" || channels[0].Currency != "USD" {
		t.Fatal("Missing USD Stripe channel")
	}
	cn, _ := s.listPayChannels("cn")
	if len(cn) != 1 || cn[0].Key != "alipay" {
		t.Fatal("Stripe leaked into CNY channels")
	}
	wrong := dto
	wrong.PlanID = "802"
	if _, err = s.createOrder(701, wrong, "en"); err == nil {
		t.Fatal("Stripe accepted CNY plan")
	}
	if _, err = s.createOrder(701, dto, "cn"); err == nil {
		t.Fatal("CN endpoint accepted Stripe")
	}
	wrong = dto
	wrong.PayChannel = "alipay"
	if _, err = s.createOrder(701, wrong, "en"); err == nil {
		t.Fatal("USD accepted CNY channel")
	}
	s.cfg.Stripe.Enabled = false
	if _, err = s.createOrder(701, dto, "en"); !errors.Is(err, errUSDCheckoutUnavailable) {
		t.Fatal("Disabled checkout accepted order")
	}
	s.cfg.Stripe.Enabled = true
	dto.Cycle = "yearly"
	vo, err := s.createOrder(701, dto, "en")
	if err != nil || vo.Amount != 120 || *vo.Credits != 7200 {
		t.Fatalf("Annual totals incorrect: %+v %v", vo, err)
	}
	for _, raw := range []string{"0", "0.49", "12.345", "1000000"} {
		if _, err := stripeCents(decimal.RequireFromString(raw)); err == nil {
			t.Fatalf("Accepted invalid Stripe amount %s", raw)
		}
	}
}

func TestStripeRejectsMismatchedPaymentAndOwner(t *testing.T) {
	s, f, dto := setupStripe(t)
	vo, err := s.createOrder(701, dto, "en")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.getOrder(vo.ID, 702); !errors.Is(err, errForbidden) {
		t.Fatal("Order leaked to another owner")
	}
	before := f.reads
	if result, err := s.verifyOrder(context.Background(), 702, vo.OrderNo); err != nil || result.Paid || f.reads != before {
		t.Fatal("Another owner queried Stripe")
	}
	if err = s.cancelOrder(vo.ID, 702); !errors.Is(err, errForbidden) {
		t.Fatal("Another owner cancelled order")
	}
	good := paidSession(f, "cs_test_1")
	for _, mutate := range []func(*stripe.CheckoutSession){
		func(v *stripe.CheckoutSession) { v.AmountTotal++ }, func(v *stripe.CheckoutSession) { v.Currency = "cny" }, func(v *stripe.CheckoutSession) { v.Livemode = true }, func(v *stripe.CheckoutSession) { v.ID = "cs_other" }, func(v *stripe.CheckoutSession) { v.Mode = "subscription" }, func(v *stripe.CheckoutSession) { v.ClientReferenceID = "702" },
	} {
		bad := *good
		mutate(&bad)
		if _, err = s.settleStripeSession(context.Background(), &bad); err == nil {
			t.Fatal("Mismatched payment was accepted")
		}
	}
	unpaid := *good
	unpaid.PaymentStatus = "unpaid"
	r, err := s.settleStripeSession(context.Background(), &unpaid)
	if err != nil || r.Paid {
		t.Fatal("Unpaid session credited")
	}
	var buyer model.User
	s.repo.db.First(&buyer, "id = 701")
	if buyer.Points != 10 {
		t.Fatal("Invalid payment granted credits")
	}
}

func TestStripeConcurrentCreateAndSettle(t *testing.T) {
	s, f, dto := setupStripe(t)
	var wg sync.WaitGroup
	ids := make(chan idgen.ID, 6)
	errs := make(chan error, 6)
	for i := 0; i < 6; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			vo, err := s.createOrder(701, dto, "en")
			if err != nil {
				errs <- err
				return
			}
			ids <- vo.ID
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Fatal(err)
	}
	close(ids)
	var id idgen.ID
	for got := range ids {
		if id != 0 && id != got {
			t.Fatal("Concurrent creates split order")
		}
		id = got
	}
	if len(f.sessions) != 1 {
		t.Fatal("Duplicate Stripe session")
	}
	paid := paidSession(f, "cs_test_1")
	errs = make(chan error, 6)
	for i := 0; i < 6; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := s.settleStripeSession(context.Background(), paid)
			if err != nil {
				errs <- err
			}
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Fatal(err)
	}
	var buyer model.User
	s.repo.db.First(&buyer, "id = 701")
	if buyer.Points != 610 {
		t.Fatal("Concurrent settlement credited more than once")
	}
}

func TestStripeCancellationAndLateSettlement(t *testing.T) {
	s, f, dto := setupStripe(t)
	vo, err := s.createOrder(701, dto, "en")
	if err != nil {
		t.Fatal(err)
	}
	if err = s.cancelOrder(vo.ID, 701); err != nil {
		t.Fatal(err)
	}
	order, _ := s.repo.findOrder(vo.ID)
	if order.Status != 2 || f.sessions["cs_test_1"].Status != "expired" {
		t.Fatal("Cancellation left checkout payable")
	}
	if _, err = s.resumeStripeCheckout(context.Background(), vo.ID, 701); err == nil {
		t.Fatal("Cancelled checkout resumed")
	}
	// A valid delayed payment received after a local expiry is still fulfilled.
	paid := paidSession(f, "cs_test_1")
	s.cfg.Stripe.Enabled = false
	if result, err := s.settleStripeSession(context.Background(), paid); err != nil || !result.Paid {
		t.Fatal("Late paid order lost its credits")
	}
}

func TestStripeWebhookSignatureAndRetry(t *testing.T) {
	s, f, dto := setupStripe(t)
	vo, err := s.createOrder(701, dto, "en")
	if err != nil {
		t.Fatal(err)
	}
	paid := paidSession(f, "cs_test_1")
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/stripe", newHandler(s).stripeWebhook)
	data, _ := json.Marshal(paid)
	payload, _ := json.Marshal(map[string]any{"id": "evt_fixture", "object": "event", "type": "checkout.session.completed", "api_version": stripe.APIVersion, "livemode": false, "data": map[string]any{"object": json.RawMessage(data)}})
	call := func(body []byte, header string) int {
		w := httptest.NewRecorder()
		r := httptest.NewRequest("POST", "/stripe", strings.NewReader(string(body)))
		r.Header.Set("Stripe-Signature", header)
		router.ServeHTTP(w, r)
		return w.Code
	}
	if call(payload, "invalid") != 400 {
		t.Fatal("Unsigned webhook accepted")
	}
	expired := webhook.GenerateTestSignedPayload(&webhook.UnsignedPayload{Payload: payload, Secret: "whsec_fixture", Timestamp: time.Now().Add(-10 * time.Minute)})
	if call(payload, expired.Header) != 400 {
		t.Fatal("Expired signature accepted")
	}
	signed := webhook.GenerateTestSignedPayload(&webhook.UnsignedPayload{Payload: payload, Secret: "whsec_fixture"})
	// A failed ledger write must roll back the paid flag and ask Stripe to retry.
	if err := s.repo.db.Migrator().DropTable(&model.PointRecord{}); err != nil {
		t.Fatal(err)
	}
	if status := call(payload, signed.Header); status != 500 {
		t.Fatalf("Failed settlement acknowledged: %d", status)
	}
	before, _ := s.repo.findOrder(vo.ID)
	if before.Status != 0 {
		t.Fatal("Failed settlement retained paid status")
	}
	if err := s.repo.db.AutoMigrate(&model.PointRecord{}); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if status := call(payload, signed.Header); status != 200 {
			t.Fatalf("Valid webhook status %d", status)
		}
	}
	var count int64
	s.repo.db.Model(&model.PointRecord{}).Where("ref_id = ?", vo.ID).Count(&count)
	if count != 1 {
		t.Fatal("Webhook replay duplicated credits")
	}
}

func TestStripePendingDeadlinesAndDisabledChannel(t *testing.T) {
	s, f, dto := setupStripe(t)
	vo, err := s.createOrder(701, dto, "en")
	if err != nil {
		t.Fatal(err)
	}
	// Stripe has a one-hour checkout window; the old 30-minute sweep cannot cancel it.
	s.repo.db.Model(&model.Order{}).Where("id = ?", vo.ID).Update("create_time", time.Now().Add(-40*time.Minute))
	if err := s.repo.cancelExpiredOrders(701, time.Now().Add(-payTTL)); err != nil {
		t.Fatal(err)
	}
	order, _ := s.repo.findOrder(vo.ID)
	if order.Status != 0 {
		t.Fatal("Legacy sweep expired valid Stripe order")
	}
	if result, err := s.verifyOrder(context.Background(), 701, vo.OrderNo); err != nil || result.Paid {
		t.Fatal("Pending session marked paid")
	}
	s.repo.db.Model(&model.PayChannel{}).Where("type = ?", "stripe").Update("enabled", false)
	if _, err := s.createOrder(701, dto, "en"); !errors.Is(err, errUSDCheckoutUnavailable) {
		t.Fatal("Disabled channel still creates orders")
	}
	paidSession(f, "cs_test_1")
	if result, err := s.verifyOrder(context.Background(), 701, vo.OrderNo); err != nil || !result.Paid {
		t.Fatal("Disabling new purchases prevented existing payment fulfillment")
	}
}

func TestBillingExpiredReadCannotOverwriteConcurrentPaidState(t *testing.T) {
	s, _, dto := setupStripe(t)
	vo, err := s.createOrder(701, dto, "en")
	if err != nil {
		t.Fatal(err)
	}
	// Exercise the shared CNY expiry path. Known Stripe sessions now reconcile
	// with the provider instead of being cancelled from a local clock alone.
	s.repo.db.Model(&model.Order{}).Where("id = ?", vo.ID).Updates(map[string]any{"pay_method": "alipay", "market": "cn", "currency": "CNY", "checkout_expires_at": nil, "create_time": time.Now().Add(-payTTL - time.Minute)})
	if err := s.repo.db.Callback().Update().Before("gorm:update").Register("test:paid_before_expiry", func(tx *gorm.DB) {
		values, ok := tx.Statement.Dest.(map[string]any)
		if !ok || values["status"] != 2 {
			return
		}
		// Reproduce a webhook committing after getOrder reads pending, but before
		// its conditional expiry update. The update must not mask the paid row.
		err := tx.Session(&gorm.Session{NewDB: true}).Exec("UPDATE `order` SET status = 1 WHERE id = ?", vo.ID).Error
		if err != nil {
			tx.AddError(err)
		}
	}); err != nil {
		t.Fatal(err)
	}
	view, err := s.getOrder(vo.ID, 701)
	if err != nil || view.Status != 1 {
		t.Fatalf("Paid order shown as cancelled: %+v %v", view, err)
	}
}

func TestStripeRefundRaceDoesNotReportPaid(t *testing.T) {
	s, f, dto := setupStripe(t)
	vo, err := s.createOrder(701, dto, "en")
	if err != nil {
		t.Fatal(err)
	}
	paid := paidSession(f, "cs_test_1")
	if _, err := s.settleStripeSession(context.Background(), paid); err != nil {
		t.Fatal(err)
	}
	if err := s.repo.db.Callback().Update().Before("gorm:update").Register("test:refund_before_settle", func(tx *gorm.DB) {
		values, ok := tx.Statement.Dest.(map[string]any)
		if !ok || values["status"] != 1 {
			return
		}
		// A finance refund wins the race with a repeated successful webhook.
		err := tx.Session(&gorm.Session{NewDB: true}).Exec("UPDATE `order` SET status = 3 WHERE id = ?", vo.ID).Error
		if err != nil {
			tx.AddError(err)
		}
	}); err != nil {
		t.Fatal(err)
	}
	result, err := s.settleStripeSession(context.Background(), paid)
	if err != nil || result.Paid || result.Granted {
		t.Fatalf("Refunded order reported as paid: %+v %v", result, err)
	}
}

func TestStripeDisabledChannelHidesExistingPaymentLink(t *testing.T) {
	s, _, dto := setupStripe(t)
	vo, err := s.createOrder(701, dto, "en")
	if err != nil {
		t.Fatal(err)
	}
	s.repo.db.Model(&model.PayChannel{}).Where("type = ?", "stripe").Update("enabled", false)
	view, err := s.getOrder(vo.ID, 701)
	if err != nil || view.PayURL != "" {
		t.Fatalf("Disabled channel still offers checkout: %+v %v", view, err)
	}
	if view.CheckoutAvailable == nil || *view.CheckoutAvailable {
		t.Fatal("Disabled checkout not disclosed to frontend")
	}
}

func TestStripeDelayedPaymentPastCheckoutDeadlineCannotBeRepurchased(t *testing.T) {
	s, f, dto := setupStripe(t)
	vo, err := s.createOrder(701, dto, "en")
	if err != nil {
		t.Fatal(err)
	}
	session := f.sessions["cs_test_1"]
	session.Status = stripe.CheckoutSessionStatusComplete
	session.PaymentStatus = stripe.CheckoutSessionPaymentStatusUnpaid
	// Checkout is complete; an asynchronous bank payment can remain pending
	// beyond the checkout URL's lifetime. It must not become a second purchase.
	if _, err := s.settleStripeSession(context.Background(), session); err != nil {
		t.Fatal(err)
	}
	s.repo.db.Model(&model.Order{}).Where("id = ?", vo.ID).Update("checkout_expires_at", time.Now().UTC().Add(-time.Minute))
	if err := s.repo.cancelExpiredOrders(701, time.Now().Add(-payTTL)); err != nil {
		t.Fatal(err)
	}
	again, err := s.createOrder(701, dto, "en")
	if err != nil || again.ID != vo.ID || again.Status != 0 || again.PayURL != "" {
		t.Fatalf("Processing payment allowed a second checkout: %+v %v", again, err)
	}
	if len(f.sessions) != 1 {
		t.Fatal("Created another session while payment was processing")
	}
	view, err := s.getOrder(vo.ID, 701)
	if err != nil || view.Status != 0 || !view.PaymentProcessing || view.ExpireTime != nil || view.CheckoutAvailable == nil || *view.CheckoutAvailable {
		t.Fatalf("Processing invoice state incorrect: %+v %v", view, err)
	}
	paidSession(f, "cs_test_1")
	result, err := s.verifyOrder(context.Background(), 701, vo.OrderNo)
	if err != nil || !result.Paid || !result.Granted {
		t.Fatalf("Delayed success did not fulfill: %+v %v", result, err)
	}
}

func TestStripeDelayedPaymentEventsFollowCurrentProviderState(t *testing.T) {
	s, f, dto := setupStripe(t)
	vo, err := s.createOrder(701, dto, "en")
	if err != nil {
		t.Fatal(err)
	}
	session := f.sessions["cs_test_1"]
	session.Status = stripe.CheckoutSessionStatusComplete
	session.PaymentStatus = stripe.CheckoutSessionPaymentStatusUnpaid
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.POST("/stripe", newHandler(s).stripeWebhook)
	deliver := func(kind string) {
		t.Helper()
		payload, _ := json.Marshal(map[string]any{"id": "evt_delayed", "object": "event", "type": kind, "api_version": stripe.APIVersion, "livemode": false, "data": map[string]any{"object": session}})
		signed := webhook.GenerateTestSignedPayload(&webhook.UnsignedPayload{Payload: payload, Secret: "whsec_fixture"})
		r := httptest.NewRequest("POST", "/stripe", strings.NewReader(string(payload)))
		r.Header.Set("Stripe-Signature", signed.Header)
		w := httptest.NewRecorder()
		router.ServeHTTP(w, r)
		if w.Code != 200 {
			t.Fatalf("%s: HTTP %d", kind, w.Code)
		}
	}
	deliver("checkout.session.completed")
	row, _ := s.repo.findOrder(vo.ID)
	if row.Status != 0 || !row.PaymentProcessing {
		t.Fatal("Unpaid completion was not processing")
	}
	deliver("checkout.session.async_payment_failed")
	row, _ = s.repo.findOrder(vo.ID)
	if row.Status != 2 || row.PaymentProcessing {
		t.Fatal("Failed asynchronous payment remained processing")
	}
	deliver("checkout.session.completed")
	row, _ = s.repo.findOrder(vo.ID)
	if row.Status != 2 || row.PaymentProcessing {
		t.Fatal("Old completed notification revived a failed payment")
	}
	paidSession(f, "cs_test_1")
	deliver("checkout.session.async_payment_succeeded")
	deliver("checkout.session.async_payment_failed")
	row, _ = s.repo.findOrder(vo.ID)
	if row.Status != 1 || row.PaymentProcessing {
		t.Fatal("Old failure downgraded a successful payment")
	}
	var buyer model.User
	s.repo.db.First(&buyer, "id = 701")
	if buyer.Points != 610 {
		t.Fatal("Delayed event retries granted incorrect credits")
	}
}

func TestStripeChangingCycleKeepsOneUnfinishedPurchase(t *testing.T) {
	s, f, dto := setupStripe(t)
	first, err := s.createOrder(701, dto, "en")
	if err != nil {
		t.Fatal(err)
	}
	f.sessions["cs_test_1"].Status = stripe.CheckoutSessionStatusComplete
	f.sessions["cs_test_1"].PaymentStatus = stripe.CheckoutSessionPaymentStatusUnpaid
	if _, err := s.settleStripeSession(context.Background(), f.sessions["cs_test_1"]); err != nil {
		t.Fatal(err)
	}
	dto.Cycle = "yearly"
	second, err := s.createOrder(701, dto, "en")
	if err != nil || second.ID != first.ID || second.Cycle != "monthly" || second.Amount != 12.5 || second.PayURL != "" || !second.ExistingCheckout || len(f.sessions) != 1 {
		t.Fatalf("Switching cycles duplicated an unfinished purchase: %+v %v", second, err)
	}
}

func TestStripeCycleCanChangeAfterConfirmedCancellation(t *testing.T) {
	s, f, dto := setupStripe(t)
	first, err := s.createOrder(701, dto, "en")
	if err != nil {
		t.Fatal(err)
	}
	dto.Cycle = "yearly"
	resumed, err := s.createOrder(701, dto, "en")
	if err != nil || resumed.ID != first.ID || !resumed.ExistingCheckout {
		t.Fatalf("Pending checkout was not reused: %+v %v", resumed, err)
	}
	if err := s.cancelOrder(first.ID, 701); err != nil {
		t.Fatal(err)
	}
	annual, err := s.createOrder(701, dto, "en")
	if err != nil || annual.ID == first.ID || annual.Amount != 120 || annual.Cycle != "yearly" || annual.ExistingCheckout || f.sessions["cs_test_1"].Status != "expired" {
		t.Fatalf("Confirmed cancellation did not permit annual purchase: %+v %v", annual, err)
	}
}

func TestStripeRejectsUnrepresentableCreditGrantsBeforePayment(t *testing.T) {
	s, _, dto := setupStripe(t)
	s.repo.db.Model(&model.Plan{}).Where("id = 801").Update("points_grant", model.MaxBillingGrantPoints/12+1)
	dto.Cycle = "yearly"
	if _, err := s.createOrder(701, dto, "en"); !errors.Is(err, errBadRequest) {
		t.Fatalf("Fixed-point balance cannot store this annual grant: %v", err)
	}
	var count int64
	s.repo.db.Model(&model.Order{}).Count(&count)
	if count != 0 {
		t.Fatal("Invalid grant created a payable order")
	}
}
