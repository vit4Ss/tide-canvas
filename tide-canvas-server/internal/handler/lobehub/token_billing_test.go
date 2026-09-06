package lobehub

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/shopspring/decimal"
	"tidecanvas/internal/model"
)

const tokenTestPricing = `{"tokenPricing":{"enabled":true,"inputPointsPerMillion":"100","outputPointsPerMillion":"300","cachedInputPointsPerMillion":"20","maxInputTokens":1000,"maxOutputTokens":1000}}`

func enableTestTokenPricing(t *testing.T, f *fixture) {
	t.Helper()
	f.s.cfg.RequireTokenPricing = true
	if err := f.s.d.DB.Model(&model.MarketModel{}).Where("model_key = ?", "test-model").Update("config", tokenTestPricing).Error; err != nil {
		t.Fatal(err)
	}
}

func TestTokenGatewayChargesActualMicrosAndReplayKeepsPriceSnapshot(t *testing.T) {
	var calls atomic.Int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		var input map[string]any
		json.NewDecoder(r.Body).Decode(&input)
		if input["stream_options"].(map[string]any)["include_usage"] != true || input["max_completion_tokens"] != float64(1000) {
			t.Error("usage or output cap not requested")
		}
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"ok\"},\"finish_reason\":\"stop\"}]}\n\ndata: {\"choices\":[],\"usage\":{\"prompt_tokens\":100,\"completion_tokens\":200,\"total_tokens\":300,\"prompt_tokens_details\":{\"cached_tokens\":20},\"completion_tokens_details\":{\"reasoning_tokens\":50}}}\n\ndata: [DONE]\n\n")
	}))
	defer up.Close()
	f := setup(t, "", up.URL)
	enableTestTokenPricing(t, f)
	headers := map[string]string{"Idempotency-Key": "token-charge"}
	w := f.request("POST", "/api/integrations/v1/chat/completions", testPrompt, f.apiKey, headers)
	if w.Code != 200 || !strings.Contains(w.Body.String(), "0.068400") {
		t.Fatal(w.Body.String())
	}
	var user model.User
	f.s.d.DB.First(&user, "id = ?", f.user.ID)
	if user.PointBalance() != 19.9316 || user.PointHeldMicros != 0 {
		t.Fatalf("wrong actual balance: %+v", user)
	}
	f.s.d.DB.Model(&model.MarketModel{}).Where("model_key = ?", "test-model").Update("config", strings.ReplaceAll(tokenTestPricing, "300", "900"))
	w = f.request("POST", "/api/integrations/v1/chat/completions", testPrompt, f.apiKey, headers)
	if w.Code != 200 || calls.Load() != 1 || !strings.Contains(w.Body.String(), "0.068400") {
		t.Fatal("replay repriced or charged again")
	}
	var ledger []model.PointRecord
	f.s.d.DB.Find(&ledger)
	if len(ledger) != 1 || ledger[0].ExactAmount() != -.0684 {
		t.Fatal("token ledger is not exact or duplicated")
	}
}

func TestMissingTokenUsageWaitsForReviewInsteadOfGuessingCost(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"visible\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
	}))
	defer up.Close()
	f := setup(t, "", up.URL)
	enableTestTokenPricing(t, f)
	w := f.request("POST", "/api/integrations/v1/chat/completions", testPrompt, f.apiKey, nil)
	if w.Code != 502 || !strings.Contains(w.Body.String(), "token_usage_unavailable") {
		t.Fatal(w.Body.String())
	}
	var row model.ModelGatewayRequest
	f.s.d.DB.First(&row)
	var user model.User
	f.s.d.DB.First(&user, "id = ?", f.user.ID)
	if row.Status != "billing_pending" || row.CostMicros != 0 || user.Points != 20 || user.PointHeldMicros != 400_000 {
		t.Fatal("missing usage was fabricated or hold was lost")
	}
}

func TestInputOnlyUsageIsChargedEvenWhenTheProviderReportsFailure(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":100,\"completion_tokens\":0,\"total_tokens\":100}}\n\ndata: {\"error\":{\"message\":\"provider failed\"}}\n\n")
	}))
	defer up.Close()
	f := setup(t, "", up.URL)
	enableTestTokenPricing(t, f)
	w := f.request("POST", "/api/integrations/v1/chat/completions", testPrompt, f.apiKey, nil)
	if w.Code != 502 || !strings.Contains(w.Body.String(), "0.010000") {
		t.Fatal(w.Body.String())
	}
	var user model.User
	f.s.d.DB.First(&user, "id = ?", f.user.ID)
	if user.PointBalance() != 19.99 || user.PointHeldMicros != 0 {
		t.Fatal("reported consumed input was incorrectly refunded")
	}
}

// With token billing required, a model that has no per-million price must not
// appear in the catalogue at all — offering it would either fall back to the
// old per-call price or fail only after the user has composed a message.
func TestModelsWithoutTokenPricingAreHiddenAndRefused(t *testing.T) {
	f := setup(t, "", "")
	enableTestTokenPricing(t, f)
	legacy := model.MarketModel{Name: "Legacy Model", ModelKey: "legacy-model", Type: "text", Status: 1, SortOrder: 5, Price: decimal.NewFromInt(9)}
	if err := f.s.d.DB.Create(&legacy).Error; err != nil {
		t.Fatal(err)
	}

	w := f.request("GET", "/api/integrations/v1/models", "", f.apiKey, nil)
	body := w.Body.String()
	if strings.Contains(body, "legacy-model") {
		t.Fatalf("a model without token pricing was offered: %s", body)
	}
	if !strings.Contains(body, "test-model") || !strings.Contains(body, "token_pricing") {
		t.Fatalf("the priced model is missing from the catalogue: %s", body)
	}

	w = f.request("POST", "/api/integrations/v1/chat/completions", strings.ReplaceAll(testPrompt, "test-model", "legacy-model"), f.apiKey, nil)
	if w.Code == 200 {
		t.Fatal("an unpriced model was charged through the token gateway")
	}
	var user model.User
	f.s.d.DB.First(&user, "id = ?", f.user.ID)
	if user.Points != 20 || user.PointHeldMicros != 0 {
		t.Fatalf("a refused model still moved points: %+v", user)
	}
}
