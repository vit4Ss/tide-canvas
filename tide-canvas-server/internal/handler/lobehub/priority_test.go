package lobehub

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"tidecanvas/internal/model"
)

// Two providers offer the same model. The operator's preference decides which
// is tried first; the other is reached only when every address of the preferred
// one has failed; and the call is priced at the preferred provider's rate,
// because that is the price the picker showed.
func TestAPreferredProviderIsTriedFirstAndPricesTheCall(t *testing.T) {
	var preferredCalls, fallbackCalls atomic.Int32
	preferred := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		preferredCalls.Add(1)
		w.WriteHeader(502)
	}))
	defer preferred.Close()
	fallback := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fallbackCalls.Add(1)
		fmt.Fprint(w, okWithUsage)
	}))
	defer fallback.Close()

	// The fixture's provider becomes the fallback: its row moves to second place.
	f := setup(t, "", fallback.URL)
	if err := f.s.d.DB.Model(&model.ChatModel{}).Where("model_key = ?", "test-model").Update("priority", 1).Error; err != nil {
		t.Fatal(err)
	}
	first := model.ChatProvider{Name: "首选中转", Enabled: true}
	if err := f.s.d.DB.Create(&first).Error; err != nil {
		t.Fatal(err)
	}
	addEndpointFor(t, f, first.ID, preferred.URL, "preferred-secret", 0)
	const preferredPrice = `{"tokenPricing":{"enabled":true,"inputPointsPerMillion":"7","outputPointsPerMillion":"7","maxInputTokens":131072,"maxOutputTokens":8192}}`
	if err := f.s.d.DB.Create(&model.ChatModel{
		ProviderID: first.ID, ModelKey: "test-model", Name: "首选那一行", Enabled: true, Priority: 0, Pricing: preferredPrice,
	}).Error; err != nil {
		t.Fatal(err)
	}

	// The catalogue shows the preferred row: its name and its price.
	offered, err := f.s.offeredModels(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	var shown *chatRoute
	for i := range offered {
		if offered[i].model.ModelKey == "test-model" {
			shown = &offered[i]
		}
	}
	if shown == nil || shown.model.Name != "首选那一行" || shown.pricing.Input != "7" {
		t.Fatalf("the catalogue did not show the preferred provider's row: %+v", shown)
	}

	// The route carries both providers' addresses, preferred first.
	route, err := f.s.routeFor(context.Background(), "test-model")
	if err != nil {
		t.Fatal(err)
	}
	if route.providers != 2 || len(route.endpoints) != 2 || route.endpoints[0].apiKey != "preferred-secret" {
		t.Fatalf("route did not order the providers by preference: providers=%d endpoints=%+v", route.providers, route.endpoints)
	}

	w := f.request("POST", "/api/integrations/v1/chat/completions", untrimmedPrompt, f.apiKey, nil)
	if w.Code != 200 {
		t.Fatalf("the fallback provider did not serve: %d %s", w.Code, w.Body.String())
	}
	if preferredCalls.Load() != 1 || fallbackCalls.Load() != 1 {
		t.Fatalf("wrong call distribution: preferred=%d fallback=%d", preferredCalls.Load(), fallbackCalls.Load())
	}

	// Billed at the preferred provider's price — the one the user was quoted —
	// even though the fallback did the work.
	var row model.ModelGatewayRequest
	if err := f.s.d.DB.Where("user_id = ?", f.user.ID).Order("id DESC").First(&row).Error; err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(row.PricingSnapshot, `"inputPointsPerMillion":"7"`) {
		t.Fatalf("the call was priced at the fallback's rate, not the quoted one: %s", row.PricingSnapshot)
	}
	var user model.User
	f.s.d.DB.First(&user, "id = ?", f.user.ID)
	if user.PointHeldMicros != 0 || user.PointBalance() >= 20 {
		t.Fatalf("settlement wrong after failover: balance=%v held=%d", user.PointBalance(), user.PointHeldMicros)
	}
}

// A preferred provider that has no usable address does not take the model down
// with it: the next provider serves, and the model stays in the catalogue under
// the preferred row's name and price.
func TestAPreferredProviderWithoutAddressesYieldsToTheNext(t *testing.T) {
	serving := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, okWithUsage)
	}))
	defer serving.Close()

	f := setup(t, "", serving.URL)
	if err := f.s.d.DB.Model(&model.ChatModel{}).Where("model_key = ?", "test-model").Update("priority", 1).Error; err != nil {
		t.Fatal(err)
	}
	empty := model.ChatProvider{Name: "没有地址的首选", Enabled: true}
	if err := f.s.d.DB.Create(&empty).Error; err != nil {
		t.Fatal(err)
	}
	if err := f.s.d.DB.Create(&model.ChatModel{
		ProviderID: empty.ID, ModelKey: "test-model", Name: "首选但没地址", Enabled: true, Priority: 0, Pricing: tokenTestPricing,
	}).Error; err != nil {
		t.Fatal(err)
	}

	route, err := f.s.routeFor(context.Background(), "test-model")
	if err != nil {
		t.Fatalf("a preferred provider with no address took the model down: %v", err)
	}
	if route.providers != 1 || len(route.endpoints) != 1 {
		t.Fatalf("unexpected route: providers=%d endpoints=%d", route.providers, len(route.endpoints))
	}
	if w := f.request("POST", "/api/integrations/v1/chat/completions", untrimmedPrompt, f.apiKey, nil); w.Code != 200 {
		t.Fatalf("the model was refused: %d %s", w.Code, w.Body.String())
	}
}
