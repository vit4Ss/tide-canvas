package chatgateway

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"tidecanvas/internal/model"
)

func TestUnsettledCandidateCostIsNeverReportedAsAnActualDebit(t *testing.T) {
	f := setup(t, "")
	_, row := pendingBill(t, f, 1_000_000)
	// Simulate an inconsistent historical reservation whose usage is valid but
	// cannot be settled within the amount held. Keep it for review, don't bill.
	price := `{"enabled":true,"inputPointsPerMillion":"50000","outputPointsPerMillion":"50000","maxInputTokens":1000,"maxOutputTokens":1000}`
	if err := f.s.d.DB.Model(row).Updates(map[string]any{"status": "pending", "pricing_snapshot": price}).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.s.settleTokens(context.Background(), row, okWithUsage, ""); err != nil {
		t.Fatal(err)
	}
	if row.Status != "billing_pending" || row.CostMicros != 0 || billingInfo(row)["points"] != "0" {
		t.Fatalf("unsettled estimate shown as spent points: status=%s cost=%d payload=%v", row.Status, row.CostMicros, billingInfo(row))
	}
	var user model.User
	if err := f.s.d.DB.First(&user, "id = ?", f.user.ID).Error; err != nil {
		t.Fatal(err)
	}
	if user.Points != 20 || user.PointHeldMicros != 1_000_000 {
		t.Fatalf("pending review moved wallet: %d/%d", user.Points, user.PointHeldMicros)
	}
	// Old data may already contain a candidate cost. Lists and idempotent
	// replays must still report zero debit until an actual settlement commits.
	if err := f.s.d.DB.Model(row).Update("cost_micros", 10_000_000).Error; err != nil {
		t.Fatal(err)
	}
	w := f.request("GET", "/api/chat-gateway/billing", "", f.jwt, nil)
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	data := jsonMap(t, w)["data"].(map[string]any)
	if data["records"].([]any)[0].(map[string]any)["points"] != "0" {
		t.Fatal("legacy ledger exposed an uncharged cost")
	}
}

const tokenTestPricing = `{"tokenPricing":{"enabled":true,"inputPointsPerMillion":"100","outputPointsPerMillion":"300","cachedInputPointsPerMillion":"20","maxInputTokens":1000,"maxOutputTokens":1000}}`

// repriceTestModel changes what the fixture's model costs.
func repriceTestModel(t *testing.T, f *fixture, pricing string) {
	t.Helper()
	if err := f.s.d.DB.Model(&model.ChatModel{}).Where("model_key = ?", "test-model").Update("pricing", pricing).Error; err != nil {
		t.Fatal(err)
	}
}

func TestTokenGatewayChargesWholePointsAndReplayKeepsPriceSnapshot(t *testing.T) {
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
	f := setup(t, up.URL)
	headers := map[string]string{"Idempotency-Key": "token-charge"}
	w := f.request("POST", "/api/integrations/v1/chat/completions", testPrompt, f.apiKey, headers)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"points":"1"`) {
		t.Fatal(w.Body.String())
	}
	var user model.User
	f.s.d.DB.First(&user, "id = ?", f.user.ID)
	if user.PointBalance() != 19 || user.PointHeldMicros != 0 {
		t.Fatalf("wrong actual balance: %+v", user)
	}
	repriceTestModel(t, f, strings.ReplaceAll(tokenTestPricing, "300", "900"))
	w = f.request("POST", "/api/integrations/v1/chat/completions", testPrompt, f.apiKey, headers)
	if w.Code != 200 || calls.Load() != 1 || !strings.Contains(w.Body.String(), `"points":"1"`) {
		t.Fatal("replay repriced or charged again")
	}
	var ledger []model.PointRecord
	f.s.d.DB.Find(&ledger)
	if len(ledger) != 1 || ledger[0].ExactAmount() != -1 {
		t.Fatal("token ledger is not whole-point or was duplicated")
	}
}

func TestMissingTokenUsageWaitsForReviewInsteadOfGuessingCost(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"visible\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
	}))
	defer up.Close()
	f := setup(t, up.URL)
	w := f.request("POST", "/api/integrations/v1/chat/completions", testPrompt, f.apiKey, nil)
	if w.Code != 502 || !strings.Contains(w.Body.String(), "token_usage_unavailable") {
		t.Fatal(w.Body.String())
	}
	var row model.ModelGatewayRequest
	f.s.d.DB.First(&row)
	var user model.User
	f.s.d.DB.First(&user, "id = ?", f.user.ID)
	if row.Status != "billing_pending" || row.CostMicros != 0 || user.Points != 20 || user.PointHeldMicros != 1_000_000 {
		t.Fatal("missing usage was fabricated or hold was lost")
	}
}

func TestInputOnlyUsageIsChargedEvenWhenTheProviderReportsFailure(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":100,\"completion_tokens\":0,\"total_tokens\":100}}\n\ndata: {\"error\":{\"message\":\"provider failed\"}}\n\n")
	}))
	defer up.Close()
	f := setup(t, up.URL)
	w := f.request("POST", "/api/integrations/v1/chat/completions", testPrompt, f.apiKey, nil)
	if w.Code != 502 || !strings.Contains(w.Body.String(), `"points":"1"`) {
		t.Fatal(w.Body.String())
	}
	var user model.User
	f.s.d.DB.First(&user, "id = ?", f.user.ID)
	if user.PointBalance() != 19 || user.PointHeldMicros != 0 {
		t.Fatal("reported consumed input was incorrectly refunded")
	}
}

func TestErrorFrameUsageIsStillCharged(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, "data: {\"error\":{\"message\":\"provider failed after reading input\"},\"usage\":{\"prompt_tokens\":100,\"completion_tokens\":0,\"total_tokens\":100}}\n\n")
	}))
	defer up.Close()
	f := setup(t, up.URL)
	f.request("POST", "/api/integrations/v1/chat/completions", testPrompt, f.apiKey, nil)
	var row model.ModelGatewayRequest
	var user model.User
	f.s.d.DB.First(&row)
	f.s.d.DB.First(&user, "id = ?", f.user.ID)
	if row.CostMicros != 1_000_000 || row.Status != "partial" || user.PointBalance() != 19 || user.PointHeldMicros != 0 {
		t.Fatalf("error-frame usage was refunded: status=%s cost=%d balance=%v held=%d", row.Status, row.CostMicros, user.PointBalance(), user.PointHeldMicros)
	}
}

func TestPartialReasoningWithoutUsageRequiresBillingReview(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"still thinking\"}}]}\n\n")
	}))
	defer up.Close()
	f := setup(t, up.URL)
	f.request("POST", "/api/integrations/v1/chat/completions", strings.TrimSuffix(testPrompt, "}")+`,"stream":true}`, f.apiKey, nil)
	var row model.ModelGatewayRequest
	var user model.User
	f.s.d.DB.First(&row)
	f.s.d.DB.First(&user, "id = ?", f.user.ID)
	if row.Status != "billing_pending" || row.CostMicros != 0 || user.PointHeldMicros != 1_000_000 {
		t.Fatalf("partial reasoning released the hold: status=%s cost=%d held=%d", row.Status, row.CostMicros, user.PointHeldMicros)
	}
}

func TestInvalidErrorFrameUsageRequiresBillingReview(t *testing.T) {
	for _, usage := range []string{
		`{"prompt_tokens":100}`,
		`{"prompt_tokens":100,"completion_tokens":0,"total_tokens":0}`,
	} {
		t.Run(usage, func(t *testing.T) {
			up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				fmt.Fprintf(w, "data: {\"error\":{\"message\":\"provider failed\"},\"usage\":%s}\n\n", usage)
			}))
			defer up.Close()
			f := setup(t, up.URL)
			w := f.request("POST", "/api/integrations/v1/chat/completions", testPrompt, f.apiKey, nil)
			var bill model.ModelGatewayRequest
			var user model.User
			if err := f.s.d.DB.First(&bill).Error; err != nil {
				t.Fatal(err)
			}
			if err := f.s.d.DB.First(&user, "id = ?", f.user.ID).Error; err != nil {
				t.Fatal(err)
			}
			if w.Code != 502 || bill.Status != "billing_pending" || bill.CostMicros != 0 || bill.UsageKnown || user.Points != 20 || user.PointHeldMicros != 1_000_000 {
				t.Fatalf("invalid usage treated as no consumption: http=%d status=%s cost=%d known=%v points=%d held=%d", w.Code, bill.Status, bill.CostMicros, bill.UsageKnown, user.Points, user.PointHeldMicros)
			}
		})
	}
}

func TestMultipleChoicesAreRejectedBeforeReservation(t *testing.T) {
	f := setup(t, "")
	w := f.request("POST", "/api/integrations/v1/chat/completions", strings.TrimSuffix(testPrompt, "}")+`,"n":2}`, f.apiKey, nil)
	if w.Code != 400 || !strings.Contains(w.Body.String(), "n=1") {
		t.Fatalf("multiple choices were not rejected: %d %s", w.Code, w.Body.String())
	}
	var held int64
	var rows int64
	var user model.User
	f.s.d.DB.First(&user, "id = ?", f.user.ID)
	f.s.d.DB.Model(&model.ModelGatewayRequest{}).Count(&rows)
	held = user.PointHeldMicros
	if rows != 0 || held != 0 || user.PointBalance() != 20 {
		t.Fatalf("rejected multiple choices moved billing state: rows=%d held=%d balance=%v", rows, held, user.PointBalance())
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
		f := setup(t, up.URL)
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
		f := setup(t, "")
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

func TestTokenCostLabelUsesIntegersForNewChargesAndKeepsLegacyPrecision(t *testing.T) {
	if got := tokenCostLabel(1_000_000); got != "1" {
		t.Fatalf("whole-point label = %q", got)
	}
	if got := tokenCostLabel(68_400); got != "0.068400" {
		t.Fatalf("legacy fractional label = %q", got)
	}
}

func TestTokenAuditUsesSettledCostRatherThanLegacyPerCallPrice(t *testing.T) {
	for _, state := range []string{"success", "partial"} {
		row := &model.ModelGatewayRequest{BillingMode: "token", Status: state, Cost: 0, CostMicros: 10_000_000}
		if got := gatewayAuditPointCost(row); got != 10 {
			t.Fatalf("%s audit cost=%d, want 10", state, got)
		}
	}
	for _, state := range []string{"pending", "billing_pending", "released", "failed"} {
		if got := gatewayAuditPointCost(&model.ModelGatewayRequest{BillingMode: "token", Status: state, CostMicros: 10_000_000}); got != 0 {
			t.Fatalf("unsettled %s was audited as charged: %d", state, got)
		}
	}
}
