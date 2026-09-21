package chatgateway

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/shopspring/decimal"
	"tidecanvas/internal/handler/points"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

func TestResaleTokenBillAndGenerationFlatChargeShareOnlyTheWallet(t *testing.T) {
	entered, release := make(chan struct{}), make(chan struct{})
	var calls atomic.Int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Header.Get("Authorization") != "Bearer upstream-secret-only" {
			t.Error("caller key leaked or wrong provider key selected")
		}
		close(entered)
		<-release
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"ok\"},\"finish_reason\":\"stop\"}]}\n\ndata: {\"choices\":[],\"usage\":{\"prompt_tokens\":100,\"completion_tokens\":200,\"total_tokens\":300,\"prompt_tokens_details\":{\"cached_tokens\":20},\"completion_tokens_details\":{\"reasoning_tokens\":50}}}\n\ndata: [DONE]\n\n")
	}))
	defer up.Close()
	released := false
	defer func() {
		if !released {
			close(release)
		}
	}()
	f := setup(t, up.URL)
	if err := f.s.d.DB.AutoMigrate(&model.MarketModel{}); err != nil {
		t.Fatal(err)
	}
	if err := f.s.d.DB.Create(&model.MarketModel{ModelKey: "test-model", Type: "text", Name: "unrelated generation model", Status: 1, Price: decimal.NewFromInt(99)}).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.s.d.DB.Model(&model.User{}).Where("id = ?", f.user.ID).Update("points", 100).Error; err != nil {
		t.Fatal(err)
	}
	repriceTestModel(t, f, `{"tokenPricing":{"enabled":true,"inputPointsPerMillion":"50000","outputPointsPerMillion":"50000","cachedInputPointsPerMillion":"10000","maxInputTokens":300,"maxOutputTokens":300}}`)
	if err := f.s.d.DB.Model(&model.ChatProvider{}).Where("1=1").Update("price_multiplier", "0.7").Error; err != nil {
		t.Fatal(err)
	}
	header := map[string]string{"Idempotency-Key": "isolated-usage"}
	finished := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		finished <- f.request("POST", "/api/integrations/v1/chat/completions", testPrompt, f.apiKey, header)
	}()
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("upstream not reached")
	}
	var user model.User
	if err := f.s.d.DB.First(&user, "id = ?", f.user.ID).Error; err != nil {
		t.Fatal(err)
	}
	if user.Points != 100 || user.PointHeldMicros != 21_000_000 {
		t.Fatalf("wrong token reserve: %d/%d", user.Points, user.PointHeldMicros)
	}
	// The generation ledger must respect funds reserved by the resale call.
	if err := points.Consume(f.s.d.DB, f.user.ID, 80, "too expensive", idgen.Next()); !errors.Is(err, points.ErrInsufficient) {
		t.Fatalf("generation spent reserved points: %v", err)
	}
	genID := idgen.Next()
	if err := f.s.d.DB.Create(&model.AiTask{ID: genID, UserID: f.user.ID, PointCost: 7, Status: 2}).Error; err != nil {
		t.Fatal(err)
	}
	if err := points.Consume(f.s.d.DB, f.user.ID, 7, "generation", genID); err != nil {
		t.Fatal(err)
	}
	// Mid-call repricing must not replace the agreed snapshot or multiplier.
	if err := f.s.d.DB.Model(&model.ChatProvider{}).Where("1=1").Update("price_multiplier", "2").Error; err != nil {
		t.Fatal(err)
	}
	close(release)
	released = true
	if w := <-finished; w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	var bill model.ModelGatewayRequest
	if err := f.s.d.DB.First(&bill).Error; err != nil {
		t.Fatal(err)
	}
	// (80*50000 + 20*10000 + 200*50000) / 1M * .7 = 9.94 -> 10.
	// Reasoning is included in output; cache is included in input.
	if bill.CostMicros != 10_000_000 || bill.PriceMultiplier != "0.7" {
		t.Fatalf("wrong token settlement: cost=%d multiplier=%s", bill.CostMicros, bill.PriceMultiplier)
	}
	if err := f.s.d.DB.First(&user, "id = ?", f.user.ID).Error; err != nil {
		t.Fatal(err)
	}
	if user.PointBalance() != 83 || user.PointHeldMicros != 0 {
		t.Fatalf("wallet=%v held=%d", user.PointBalance(), user.PointHeldMicros)
	}
	if w := f.request("POST", "/api/integrations/v1/chat/completions", testPrompt, f.apiKey, header); w.Code != 200 || calls.Load() != 1 {
		t.Fatal("replay billed or called upstream twice")
	}
	for i := 0; i < 2; i++ {
		if err := points.Refund(f.s.d.DB, f.user.ID, 7, "generation refund", genID); err != nil {
			t.Fatal(err)
		}
	}
	if err := f.s.d.DB.First(&user, "id = ?", f.user.ID).Error; err != nil {
		t.Fatal(err)
	}
	if user.PointBalance() != 90 {
		t.Fatalf("generation refund changed token bill: %v", user.PointBalance())
	}
	var ledger []model.PointRecord
	f.s.d.DB.Order("id").Find(&ledger)
	if len(ledger) != 3 {
		t.Fatalf("wrong ledger length: %+v", ledger)
	}
	var net float64
	for _, row := range ledger {
		net += row.ExactAmount()
	}
	if net != -10 {
		t.Fatalf("ledger differs from wallet: %v", net)
	}
	d := usageData(t, f, "/api/chat-gateway/usage", f.jwt)
	if d["total"] != float64(1) || d["summary"].(map[string]any)["points"] != "10" {
		t.Fatalf("generation mixed into resale records: %v", d)
	}
}
