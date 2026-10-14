package chatgateway

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/tokenbilling"
)

func TestScreenshotPricingCatalogueSettlementAndReplayAgree(t *testing.T) {
	var calls atomic.Int32
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"ok\"},\"finish_reason\":\"stop\"}]}\n\n")
		fmt.Fprint(w, "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":128000,\"completion_tokens\":8000,\"total_tokens\":136000,\"prompt_tokens_details\":{\"cached_tokens\":64000}}}\n\ndata: [DONE]\n\n")
	}))
	defer upstream.Close()
	f := setup(t, upstream.URL)
	raw, err := json.Marshal(map[string]any{"tokenPricing": model.ChatReferencePricing("gpt-6.1-sol")})
	if err != nil {
		t.Fatal(err)
	}
	if err := f.s.d.DB.Model(&model.ChatModel{}).Where("model_key = ?", "test-model").Updates(map[string]any{"model_key": "gpt-6.1-sol", "pricing": string(raw)}).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.s.d.DB.Model(&model.ChatProvider{}).Where("name = ?", "Test Provider").Update("price_multiplier", "2").Error; err != nil {
		t.Fatal(err)
	}
	list := f.request("GET", "/api/integrations/v1/models", "", f.apiKey, nil)
	var catalogue struct {
		Data []struct {
			TokenPricing tokenbilling.Pricing `json:"token_pricing"`
		} `json:"data"`
	}
	if err := json.Unmarshal(list.Body.Bytes(), &catalogue); err != nil {
		t.Fatal(err)
	}
	if list.Code != 200 || len(catalogue.Data) != 1 {
		t.Fatalf("catalogue: %d %s", list.Code, list.Body.String())
	}
	p := catalogue.Data[0].TokenPricing
	if p.Input != "20" || p.Output != "100" || p.CachedInput != "1" {
		t.Fatalf("catalogue rates: %+v", p)
	}
	body := `{"model":"gpt-6.1-sol","messages":[{"role":"user","content":"hello"}],"max_tokens":8192}`
	headers := map[string]string{"Idempotency-Key": "reference-price-2x"}
	for i := 0; i < 2; i++ {
		result := f.request("POST", "/api/integrations/v1/chat/completions", body, f.apiKey, headers)
		if result.Code != 200 {
			t.Fatalf("chat: %d %s", result.Code, result.Body.String())
		}
	}
	var bill model.ModelGatewayRequest
	if err := f.s.d.DB.First(&bill).Error; err != nil {
		t.Fatal(err)
	}
	// (64000*20 + 64000*1 + 8000*100) / 1M = 2.144, posting 2 whole points and carrying 0.144.
	if bill.CostMicros != 2_144_000 || bill.WalletDebitMicros != 2*tokenbilling.Scale || bill.PendingAfterMicros != 144_000 || bill.PriceMultiplier != "2" || bill.CachedInputTokens != 64000 || calls.Load() != 1 {
		t.Fatalf("wrong bill or duplicate request: %+v, calls=%d", bill, calls.Load())
	}
	var user model.User
	if err := f.s.d.DB.First(&user, "id = ?", f.user.ID).Error; err != nil {
		t.Fatal(err)
	}
	if user.PointBalance() != 17.856 || user.Points != 18 || user.ChatPendingMicros != 144_000 || user.PointHeldMicros != 0 {
		t.Fatalf("wallet after settlement/replay: %v, held=%d", user.PointBalance(), user.PointHeldMicros)
	}
}
