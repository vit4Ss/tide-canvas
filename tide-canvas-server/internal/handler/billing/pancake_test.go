package billing

import (
	"context"
	"encoding/json"
	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"tidecanvas/internal/config"
	"tidecanvas/internal/model"
	"time"
)

type pancakeFixture struct {
	requests []map[string]any
	orders   []pancakeOrder
	fail     bool
	event    map[string]string
}

func setupPancake(t *testing.T) (*service, *pancakeFixture, CreateOrderDTO) {
	t.Helper()
	s, _, dto := setupStripe(t)
	dto.PayChannel = "pancake"
	f := &pancakeFixture{event: map[string]string{}}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+strings.Repeat("t", 32) {
			t.Error("missing internal auth")
			w.WriteHeader(401)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/checkout":
			var body map[string]any
			_ = json.NewDecoder(r.Body).Decode(&body)
			f.requests = append(f.requests, body)
			if f.fail {
				w.WriteHeader(502)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"sessionId": "cs_" + body["orderId"].(string), "checkoutUrl": "https://checkout.waffo.ai/store/checkout/cs_" + body["orderId"].(string), "expiresAt": time.Now().Add(time.Hour)})
		case "/orders":
			_ = json.NewEncoder(w).Encode(map[string]any{"orders": f.orders})
		case "/verify-webhook":
			if r.Header.Get("X-Waffo-Signature") != "valid" {
				w.WriteHeader(400)
				return
			}
			_ = json.NewEncoder(w).Encode(f.event)
		default:
			w.WriteHeader(404)
		}
	}))
	t.Cleanup(server.Close)
	s.cfg.Pancake = config.PancakeConfig{Enabled: true, AdapterURL: server.URL, InternalToken: strings.Repeat("t", 32), StoreID: "STO_fixture", ProductID: "PROD_fixture", SiteURL: "http://localhost:3100"}
	if err := s.repo.db.Create(&model.PayChannel{Type: "pancake", Name: "Pancake", Enabled: true}).Error; err != nil {
		t.Fatal(err)
	}
	return s, f, dto
}
func pancakePaid(t *testing.T, s *service, vo *OrderVO) pancakeOrder {
	t.Helper()
	o, err := s.repo.findOrder(vo.ID)
	if err != nil {
		t.Fatal(err)
	}
	var snap pancakePurchase
	if err := json.Unmarshal([]byte(o.PurchaseSnapshot), &snap); err != nil {
		t.Fatal(err)
	}
	return pancakeOrder{ProviderID: "ORD_" + o.ID.String(), PaymentID: "PAY_" + o.ID.String(), Reference: pancakeRef("test", o.ID), Mode: "test", StoreID: snap.StoreID, ProductID: snap.ProductID, Currency: "USD", Subtotal: o.Amount, Tax: decimal.RequireFromString("1.25"), Total: o.Amount.Add(decimal.RequireFromString("1.25")), Paid: true, Metadata: map[string]string{"nonce": snap.Nonce, "order_id": o.ID.String(), "buyer_id": o.UserID.String(), "market": "en", "environment": "test"}}
}
func TestPancakePurchaseRecoveryAndSharedLedger(t *testing.T) {
	s, f, dto := setupPancake(t)
	f.fail = true
	if _, err := s.createOrder(701, dto, "en"); err == nil {
		t.Fatal("ambiguous request should fail")
	}
	f.fail = false
	vo, err := s.createOrder(701, dto, "en")
	if err != nil {
		t.Fatal(err)
	}
	if !vo.ExistingCheckout || len(f.requests) != 2 || f.requests[0]["reference"] != f.requests[1]["reference"] || f.requests[0]["nonce"] != f.requests[1]["nonce"] {
		t.Fatal("retry did not reuse original order")
	}
	if f.requests[1]["amount"] != "12.50" || vo.CancelAvailable == nil || *vo.CancelAvailable {
		t.Fatal("wrong amount or unsafe cancellation")
	}
	if _, err := s.getOrder(vo.ID, 702); err != errForbidden {
		t.Fatal("wrong owner read")
	}
	if err := s.cancelOrder(vo.ID, 701); err == nil {
		t.Fatal("cannot locally cancel a live payment session")
	}
	s.repo.db.Model(&model.User{}).Where("id = 701").Updates(map[string]any{"point_fraction": 250000, "point_held_micros": 5000000})
	p := pancakePaid(t, s, vo)
	f.orders = []pancakeOrder{p}
	for i := 0; i < 3; i++ {
		res, err := s.verifyOrder(context.Background(), 701, vo.OrderNo)
		if err != nil || !res.Paid || res.Granted != (i == 0) {
			t.Fatalf("settlement %d: %+v %v", i, res, err)
		}
	}
	var u model.User
	s.repo.db.First(&u, "id = 701")
	if u.Points != 610 || u.PointFraction != 250000 || u.PointHeldMicros != 5000000 {
		t.Fatalf("damaged balance: %+v", u)
	}
	detail, _ := s.getOrder(vo.ID, 701)
	if detail.ChargedTotal != 13.75 || detail.TaxTotal != 1.25 || detail.PayURL != "" {
		t.Fatalf("wrong receipt: %+v", detail)
	}
}
func TestPancakeRejectsMismatchedSettlement(t *testing.T) {
	cases := []struct {
		name   string
		change func(*pancakeOrder)
	}{
		{"amount", func(p *pancakeOrder) { p.Subtotal = decimal.NewFromInt(1) }},
		{"currency", func(p *pancakeOrder) { p.Currency = "CNY" }},
		{"store", func(p *pancakeOrder) { p.StoreID = "STO_other" }},
		{"product", func(p *pancakeOrder) { p.ProductID = "PROD_other" }},
		{"environment", func(p *pancakeOrder) { p.Mode = "prod" }},
		{"nonce", func(p *pancakeOrder) { p.Metadata["nonce"] = "bad" }},
		{"owner", func(p *pancakeOrder) { p.Metadata["buyer_id"] = "702" }},
		{"paid", func(p *pancakeOrder) { p.Paid = false }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s, _, dto := setupPancake(t)
			vo, err := s.createOrder(701, dto, "en")
			if err != nil {
				t.Fatal(err)
			}
			p := pancakePaid(t, s, vo)
			tc.change(&p)
			if _, err := s.settlePancake(vo.ID, p); err == nil {
				t.Fatal("tampering accepted")
			}
			var u model.User
			s.repo.db.First(&u, "id = 701")
			if u.Points != 10 {
				t.Fatal("credits granted for invalid payment")
			}
		})
	}
}
func TestPancakeRefundOrderingAndIdempotency(t *testing.T) {
	for _, early := range []bool{false, true} {
		t.Run(map[bool]string{true: "refund before payment notification", false: "partial then full"}[early], func(t *testing.T) {
			s, _, dto := setupPancake(t)
			vo, err := s.createOrder(701, dto, "en")
			if err != nil {
				t.Fatal(err)
			}
			p := pancakePaid(t, s, vo)
			if !early {
				if _, err = s.settlePancake(vo.ID, p); err != nil {
					t.Fatal(err)
				}
				p.Refunded = p.Total.Mul(decimal.RequireFromString("0.4"))
				for i := 0; i < 2; i++ {
					if _, err = s.settlePancake(vo.ID, p); err != nil {
						t.Fatal(err)
					}
				}
				var u model.User
				s.repo.db.First(&u, "id = 701")
				if u.Points != 370 {
					t.Fatalf("partial refund balance %d", u.Points)
				}
			}
			p.Refunded = p.Total
			for i := 0; i < 2; i++ {
				if _, err = s.settlePancake(vo.ID, p); err != nil {
					t.Fatal(err)
				}
			}
			p.Refunded = decimal.Zero
			if _, err = s.settlePancake(vo.ID, p); err != nil {
				t.Fatal(err)
			}
			var u model.User
			s.repo.db.First(&u, "id = 701")
			o, _ := s.repo.findOrder(vo.ID)
			if u.Points != 10 || o.Status != 3 {
				t.Fatalf("refund replay changed balance/state: %d %d", u.Points, o.Status)
			}
			if early && u.VipLevel != 0 {
				t.Fatal("refunded purchase granted membership")
			}
		})
	}
}
func TestPancakeWebhookWaitsForCanonicalPaymentAndCommit(t *testing.T) {
	s, f, dto := setupPancake(t)
	vo, err := s.createOrder(701, dto, "en")
	if err != nil {
		t.Fatal(err)
	}
	p := pancakePaid(t, s, vo)
	f.event = map[string]string{"id": "delivery", "eventId": p.PaymentID, "type": "order.completed", "reference": p.Reference, "providerId": p.ProviderID}
	handler := newHandler(s)
	deliver := func(signature string) int {
		rec := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(rec)
		c.Request = httptest.NewRequest("POST", "/", strings.NewReader(`{"raw":true}`))
		c.Request.Header.Set("X-Waffo-Signature", signature)
		handler.pancakeWebhook(c)
		c.Writer.WriteHeaderNow()
		return rec.Code
	}
	if deliver("invalid") != 400 {
		t.Fatal("bad signature accepted")
	}
	if deliver("valid") != 503 {
		t.Fatal("unconfirmed event prematurely acknowledged")
	}
	f.orders = []pancakeOrder{p}
	s.repo.db.Exec(`CREATE TRIGGER fail_pancake_ledger BEFORE INSERT ON point_record BEGIN SELECT RAISE(ABORT, 'fixture'); END`)
	if deliver("valid") != 503 {
		t.Fatal("database failure acknowledged")
	}
	o, _ := s.repo.findOrder(vo.ID)
	if o.Status != 0 {
		t.Fatal("failed ledger committed paid status")
	}
	s.repo.db.Exec(`DROP TRIGGER fail_pancake_ledger`)
	if deliver("valid") != 200 || deliver("valid") != 200 {
		t.Fatal("retry failed")
	}
	var u model.User
	s.repo.db.First(&u, "id = 701")
	if u.Points != 610 {
		t.Fatal("duplicate webhook credited twice")
	}
}
func TestPancakePendingProviderSwitchAndExpiry(t *testing.T) {
	s, _, dto := setupPancake(t)
	vo, err := s.createOrder(701, dto, "en")
	if err != nil {
		t.Fatal(err)
	}
	dto.PayChannel = "stripe"
	other, err := s.createOrder(701, dto, "en")
	if err != nil || other.ID != vo.ID || other.PayMethod != "pancake" {
		t.Fatal("provider switch created a duplicate purchase")
	}
	s.repo.db.Model(&model.Order{}).Where("id = ?", vo.ID).Updates(map[string]any{"create_time": time.Now().Add(-48 * time.Hour), "checkout_expires_at": time.Now().Add(-time.Hour)})
	if err := s.repo.cancelExpiredOrders(701, time.Now()); err != nil {
		t.Fatal(err)
	}
	result, err := s.getOrder(vo.ID, 701)
	if err != nil || result.Status != 0 || result.PayURL != "" {
		t.Fatal("expiry hid a possibly accepted payment")
	}
	dto.PayChannel = "pancake"
	dto.PlanID = "802"
	if _, err := s.createOrder(701, dto, "en"); err == nil {
		t.Fatal("CNY plan accepted")
	}
}

func TestPancakeConcurrentDeliveryUsesImmutableGrant(t *testing.T) {
	s, _, dto := setupPancake(t)
	vo, err := s.createOrder(701, dto, "en")
	if err != nil {
		t.Fatal(err)
	}
	p := pancakePaid(t, s, vo)
	if err := s.repo.db.Model(&model.Plan{}).Where("id = 801").Updates(map[string]any{"price": 999, "points_grant": 9999}).Error; err != nil {
		t.Fatal(err)
	}
	var group sync.WaitGroup
	failures := make(chan error, 8)
	for i := 0; i < 8; i++ {
		group.Add(1)
		go func() { defer group.Done(); _, e := s.settlePancake(vo.ID, p); failures <- e }()
	}
	group.Wait()
	close(failures)
	for e := range failures {
		if e != nil {
			t.Fatal(e)
		}
	}
	var user model.User
	s.repo.db.First(&user, "id = 701")
	if user.Points != 610 {
		t.Fatalf("duplicate or repriced grant %d", user.Points)
	}
	var count int64
	s.repo.db.Model(&model.PointRecord{}).Where("ref_id = ? AND change_type = ?", vo.ID, "recharge").Count(&count)
	if count != 1 {
		t.Fatalf("expected one ledger row, got %d", count)
	}
}
