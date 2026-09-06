package lobehub

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"tidecanvas/internal/model"
)

const tokenTestPricing = `{"tokenPricing":{"enabled":true,"inputPointsPerMillion":"100","outputPointsPerMillion":"300","cachedInputPointsPerMillion":"20","maxInputTokens":1000,"maxOutputTokens":1000}}`

// repriceTestModel changes what the fixture's model costs.
func repriceTestModel(t *testing.T, f *fixture, pricing string) {
	t.Helper()
	if err := f.s.d.DB.Model(&model.ChatModel{}).Where("model_key = ?", "test-model").Update("pricing", pricing).Error; err != nil {
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
	repriceTestModel(t, f, strings.ReplaceAll(tokenTestPricing, "300", "900"))
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

// Every AI chat model is token priced. One left unpriced — or priced with
// numbers that cannot be read — is not offered and cannot be called, because
// there would be no way to charge for it.
func TestAnUnpricedModelIsNeitherOfferedNorCallable(t *testing.T) {
	var upstreamCalls atomic.Int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upstreamCalls.Add(1)
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer up.Close()

	for _, pricing := range []string{"", `{"tokenPricing":{"enabled":true,"inputPointsPerMillion":"abc","outputPointsPerMillion":"300"}}`} {
		f := setup(t, "", up.URL)
		repriceTestModel(t, f, pricing)

		if body := f.request("GET", "/api/integrations/v1/models", "", f.apiKey, nil).Body.String(); strings.Contains(body, "test-model") {
			t.Fatalf("pricing %q: an unbillable model was offered: %s", pricing, body)
		}
		w := f.request("POST", "/api/integrations/v1/chat/completions", testPrompt, f.apiKey, nil)
		if w.Code == 200 || !strings.Contains(w.Body.String(), "model_not_available") {
			t.Fatalf("pricing %q: an unbillable model was callable: %d %s", pricing, w.Code, w.Body.String())
		}
		var user model.User
		f.s.d.DB.First(&user, "id = ?", f.user.ID)
		if user.Points != 20 || user.PointHeldMicros != 0 {
			t.Fatalf("pricing %q: a refused model still moved points: %+v", pricing, user)
		}
	}
	if upstreamCalls.Load() != 0 {
		t.Fatal("an unbillable model still reached an upstream")
	}
}

// A disabled model, or one whose provider is switched off, disappears from the
// catalogue as a whole — the provider switch is how an operator takes a whole
// supplier out of service.
func TestDisablingAModelOrItsProviderWithdrawsIt(t *testing.T) {
	for _, disable := range []string{"model", "provider"} {
		f := setup(t, "", "")
		var err error
		if disable == "model" {
			err = f.s.d.DB.Model(&model.ChatModel{}).Where("model_key = ?", "test-model").Update("enabled", false).Error
		} else {
			err = f.s.d.DB.Model(&model.ChatProvider{}).Where("1 = 1").Update("enabled", false).Error
		}
		if err != nil {
			t.Fatal(err)
		}
		if body := f.request("GET", "/api/integrations/v1/models", "", f.apiKey, nil).Body.String(); strings.Contains(body, "test-model") {
			t.Fatalf("disabling the %s left the model on offer: %s", disable, body)
		}
		if w := f.request("POST", "/api/integrations/v1/chat/completions", testPrompt, f.apiKey, nil); w.Code == 200 {
			t.Fatalf("disabling the %s left the model callable", disable)
		}
	}
}
