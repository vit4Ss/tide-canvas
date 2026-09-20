package chatgateway

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/tokenbilling"
)

// A provider's multiplier changes what a call is sold at — the catalogue, the
// hold and the settlement — while the model row keeps the rates the operator
// listed. An unusable multiplier withdraws the provider's models rather than
// selling them at list.
func TestAProviderMultiplierScalesTheSaleNotTheListing(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprint(w, okWithUsage)
	}))
	defer upstream.Close()
	f := setup(t, upstream.URL)
	// 100 prompt + 100 completion tokens at 50000/1M each is 10 points at list.
	// Limits of 200 keep the hold (20 points) inside the user's balance of 20.
	repriceTestModel(t, f, `{"tokenPricing":{"enabled":true,"inputPointsPerMillion":"50000","outputPointsPerMillion":"50000","maxInputTokens":200,"maxOutputTokens":200}}`)
	setMultiplier := func(value string) {
		if err := f.s.d.DB.Model(&model.ChatProvider{}).Where("name = ?", "Test Provider").Update("price_multiplier", value).Error; err != nil {
			t.Fatal(err)
		}
	}
	balance := func() float64 {
		var user model.User
		f.s.d.DB.First(&user, "id = ?", f.user.ID)
		return user.PointBalance()
	}

	setMultiplier("0.5")
	w := f.request("GET", "/api/integrations/v1/models", "", f.apiKey, nil)
	if w.Code != 200 {
		t.Fatalf("model list failed: %d %s", w.Code, w.Body.String())
	}
	var list struct {
		Data []struct {
			ID           string               `json:"id"`
			TokenPricing tokenbilling.Pricing `json:"token_pricing"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	if len(list.Data) != 1 || list.Data[0].TokenPricing.Input != "25000" || list.Data[0].TokenPricing.Output != "25000" {
		t.Fatalf("the catalogue does not show the scaled rate: %s", w.Body.String())
	}

	w = f.request("POST", "/api/integrations/v1/chat/completions", testPrompt, f.apiKey, nil)
	if w.Code != 200 {
		t.Fatalf("call failed: %d %s", w.Code, w.Body.String())
	}
	if got := balance(); got != 15 {
		t.Fatalf("balance after a half-price call = %v, want 15 (20 - 5); at list it would be 10", got)
	}
	var row model.ChatModel
	f.s.d.DB.First(&row, "model_key = ?", "test-model")
	listed, err := tokenbilling.Parse(row.Pricing)
	if err != nil || listed.Input != "50000" {
		t.Fatalf("the multiplier must not rewrite the listed rates: %+v %v", listed, err)
	}

	// An operator saves a multiplier the parser refuses (the admin API blocks
	// this; a direct database edit would not). Fail closed: the model leaves
	// the catalogue and a call is refused before anything is charged.
	setMultiplier("abc")
	w = f.request("GET", "/api/integrations/v1/models", "", f.apiKey, nil)
	if w.Code != 200 || len(w.Body.String()) == 0 {
		t.Fatalf("model list failed: %d", w.Code)
	}
	list.Data = nil
	if err := json.Unmarshal(w.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	if len(list.Data) != 0 {
		t.Fatalf("a model under an unusable multiplier is still on sale: %s", w.Body.String())
	}
	w = f.request("POST", "/api/integrations/v1/chat/completions", testPrompt, f.apiKey, nil)
	if w.Code == 200 {
		t.Fatalf("a call was served at list price despite an unusable multiplier: %s", w.Body.String())
	}
	if got := balance(); got != 15 {
		t.Fatalf("a refused call still moved the balance: %v", got)
	}
}
