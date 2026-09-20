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
	"tidecanvas/internal/pkg/idgen"
)

const okWithUsage = "data: {\"choices\":[{\"delta\":{\"content\":\"ok\"},\"finish_reason\":\"stop\"}]}\n\ndata: {\"choices\":[],\"usage\":{\"prompt_tokens\":100,\"completion_tokens\":100,\"total_tokens\":200}}\n\ndata: [DONE]\n\n"

// addEndpoint appends another address to the fixture's provider, after the ones
// already there.
func addEndpoint(t *testing.T, f *fixture, baseURL, apiKey string, order int) model.ChatEndpoint {
	t.Helper()
	var provider model.ChatProvider
	if err := f.s.d.DB.First(&provider).Error; err != nil {
		t.Fatal(err)
	}
	return addEndpointFor(t, f, provider.ID, baseURL, apiKey, order)
}

// addEndpointFor is the same, for a provider the test created itself.
func addEndpointFor(t *testing.T, f *fixture, provider idgen.ID, baseURL, apiKey string, order int) model.ChatEndpoint {
	t.Helper()
	sealed, err := f.s.upstreams.Seal(apiKey)
	if err != nil {
		t.Fatal(err)
	}
	row := model.ChatEndpoint{ProviderID: provider, Label: baseURL, BaseURL: baseURL, APIKey: sealed, Enabled: true, SortOrder: order}
	if err := f.s.d.DB.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	return row
}

// A dead primary must cost the user nothing extra: the call moves to the backup
// address, is charged once, and the backup's own credential is what goes out.
func TestAFailedAddressFallsThroughToTheBackup(t *testing.T) {
	var primaryCalls, backupCalls atomic.Int32
	var backupAuth string
	primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		primaryCalls.Add(1)
		w.WriteHeader(502)
	}))
	defer primary.Close()
	backup := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		backupCalls.Add(1)
		backupAuth = r.Header.Get("Authorization")
		fmt.Fprint(w, okWithUsage)
	}))
	defer backup.Close()

	f := setup(t, primary.URL)
	// The fixture's endpoint is the primary (sort 0); this one comes after it.
	addEndpoint(t, f, backup.URL, "backup-secret", 1)

	w := f.request("POST", "/api/integrations/v1/chat/completions", testPrompt, f.apiKey, nil)
	if w.Code != 200 {
		t.Fatalf("failover did not deliver: %d %s", w.Code, w.Body.String())
	}
	if primaryCalls.Load() != 1 || backupCalls.Load() != 1 {
		t.Fatalf("wrong call distribution: primary=%d backup=%d", primaryCalls.Load(), backupCalls.Load())
	}
	if backupAuth != "Bearer backup-secret" {
		t.Fatalf("the backup was called with the wrong credential: %q", backupAuth)
	}
	var user model.User
	f.s.d.DB.First(&user, "id = ?", f.user.ID)
	if user.PointBalance() != 19 || user.PointHeldMicros != 0 {
		t.Fatalf("failover charged twice or stranded a hold: %v held=%d", user.PointBalance(), user.PointHeldMicros)
	}
}

// Once an upstream has started answering, its stream is the answer. Retrying
// elsewhere would repeat text the user already has and bill both attempts.
func TestFailoverStopsOnceAResponseHasStarted(t *testing.T) {
	var secondCalls atomic.Int32
	first := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"half\"}}]}\n\n")
		// then drop without finishing
	}))
	defer first.Close()
	second := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		secondCalls.Add(1)
		fmt.Fprint(w, okWithUsage)
	}))
	defer second.Close()

	f := setup(t, first.URL)
	addEndpoint(t, f, second.URL, "second-secret", 1)

	w := f.request("POST", "/api/integrations/v1/chat/completions", testPrompt, f.apiKey, nil)
	if secondCalls.Load() != 0 {
		t.Fatalf("an interrupted stream was retried on another address: %s", w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "half") {
		t.Fatalf("the partial answer was dropped: %s", w.Body.String())
	}
}

// Every address failing is a refusal, not a charge.
func TestWhenEveryAddressFailsNothingIsCharged(t *testing.T) {
	dead := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(500)
	}))
	defer dead.Close()

	f := setup(t, dead.URL)
	addEndpoint(t, f, dead.URL, "another-secret", 1)

	if w := f.request("POST", "/api/integrations/v1/chat/completions", testPrompt, f.apiKey, nil); w.Code == 200 {
		t.Fatalf("a dead provider reported success: %s", w.Body.String())
	}
	var user model.User
	f.s.d.DB.First(&user, "id = ?", f.user.ID)
	if user.Points != 20 || user.PointHeldMicros != 0 {
		t.Fatalf("a failed call kept money: %+v", user)
	}
	// The admin list should show why, without any of it reaching a caller.
	var endpoints []model.ChatEndpoint
	f.s.d.DB.Find(&endpoints)
	noted := false
	for _, e := range endpoints {
		if e.LastFailure != "" && e.LastFailedAt != nil {
			noted = true
		}
	}
	if !noted {
		t.Fatal("no address recorded its failure for the operator")
	}
}

// An address whose credential cannot be opened is skipped, not fatal: the
// provider's other addresses still serve.
func TestAnUnreadableCredentialSkipsOnlyThatAddress(t *testing.T) {
	good := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, okWithUsage)
	}))
	defer good.Close()

	f := setup(t, good.URL)
	// Corrupt the fixture's endpoint and add a working one after it.
	if err := f.s.d.DB.Model(&model.ChatEndpoint{}).Where("1 = 1").Update("api_key", "v1:not-openable").Error; err != nil {
		t.Fatal(err)
	}
	addEndpoint(t, f, good.URL, "healthy-secret", 1)

	if w := f.request("POST", "/api/integrations/v1/chat/completions", testPrompt, f.apiKey, nil); w.Code != 200 {
		t.Fatalf("a single broken credential took the provider down: %d %s", w.Code, w.Body.String())
	}

	// With no readable credential at all, the model is refused rather than
	// called anonymously.
	f2 := setup(t, good.URL)
	if err := f2.s.d.DB.Model(&model.ChatEndpoint{}).Where("1 = 1").Update("api_key", "v1:not-openable").Error; err != nil {
		t.Fatal(err)
	}
	w := f2.request("POST", "/api/integrations/v1/chat/completions", testPrompt, f2.apiKey, nil)
	if w.Code == 200 || !strings.Contains(w.Body.String(), "upstream_unavailable") {
		t.Fatalf("a provider with no usable credential was still called: %d %s", w.Code, w.Body.String())
	}
	var user model.User
	f2.s.d.DB.First(&user, "id = ?", f2.user.ID)
	if user.Points != 20 || user.PointHeldMicros != 0 {
		t.Fatalf("a refused call moved money: %+v", user)
	}
}

// The operator's third-party credentials must never reach the caller, even if
// an upstream echoes one back in an error body.
func TestAnUpstreamEchoingItsCredentialDoesNotForwardIt(t *testing.T) {
	leaky := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, "data: {\"error\":{\"message\":\"bad key upstream-secret-only\"}}\n\n")
	}))
	defer leaky.Close()

	f := setup(t, leaky.URL)
	w := f.request("POST", "/api/integrations/v1/chat/completions", testPrompt, f.apiKey, nil)
	// The provider's wording reaches the caller — that is the point of passing
	// errors through — but the credential inside it must not.
	if strings.Contains(w.Body.String(), "upstream-secret-only") {
		t.Fatalf("the upstream credential was forwarded to the caller: %s", w.Body.String())
	}
	if !strings.Contains(w.Body.String(), "bad key [REDACTED]") {
		t.Fatalf("the provider's reason was not passed through with the secret scrubbed: %s", w.Body.String())
	}
}

// offeredModels is what both the catalogue and the sync read, so a provider
// without any address must not appear as something a user can pick.
func TestRoutingReportsAProviderWithNoAddress(t *testing.T) {
	f := setup(t, "")
	if err := f.s.d.DB.Where("1 = 1").Delete(&model.ChatEndpoint{}).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := f.s.routeFor(context.Background(), "test-model"); err == nil {
		t.Fatal("a provider with no address resolved to a route")
	}
	w := f.request("POST", "/api/integrations/v1/chat/completions", testPrompt, f.apiKey, nil)
	if w.Code != 503 || !strings.Contains(w.Body.String(), "upstream_unavailable") {
		t.Fatalf("expected an explicit refusal: %d %s", w.Code, w.Body.String())
	}
}

// routeFor repeats offeredModels' selection rule instead of calling it, so the
// two can drift. They must not: the picker shows a price taken from the row
// offeredModels picked, and the call is charged at the row routeFor picked.
func TestTheChargedRowIsTheRowTheCatalogueShowed(t *testing.T) {
	f := setup(t, "")
	ctx := context.Background()

	// A second provider offering the same key, cheaper, but listed first — and
	// two more rows that must be passed over: an unpriced one ahead of everyone,
	// and one under a provider that is switched off.
	const cheap = `{"tokenPricing":{"enabled":true,"inputPointsPerMillion":"1","outputPointsPerMillion":"1"}}`
	off := model.ChatProvider{Name: "Disabled Provider", Enabled: false}
	if err := f.s.d.DB.Create(&off).Error; err != nil {
		t.Fatal(err)
	}
	second := model.ChatProvider{Name: "Second Provider", Enabled: true, SortOrder: 5}
	if err := f.s.d.DB.Create(&second).Error; err != nil {
		t.Fatal(err)
	}
	addEndpointFor(t, f, second.ID, "https://second.example.com", "second-secret", 0)
	for _, row := range []model.ChatModel{
		{ProviderID: second.ID, ModelKey: "test-model", Name: "unpriced", Enabled: true, SortOrder: -20},
		{ProviderID: off.ID, ModelKey: "test-model", Name: "switched off", Enabled: true, SortOrder: -10, Pricing: cheap},
		{ProviderID: second.ID, ModelKey: "test-model", Name: "cheap", Enabled: true, SortOrder: -5, Pricing: cheap},
	} {
		if err := f.s.d.DB.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
	}

	offered, err := f.s.offeredModels(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var shown *chatRoute
	for i := range offered {
		if offered[i].model.ModelKey == "test-model" {
			shown = &offered[i]
			break
		}
	}
	if shown == nil {
		t.Fatal("the catalogue stopped offering the model")
	}
	if shown.model.Name != "cheap" {
		t.Fatalf("the catalogue picked %q; the unpriced and switched-off rows should have been passed over", shown.model.Name)
	}

	route, err := f.s.routeFor(ctx, "test-model")
	if err != nil {
		t.Fatal(err)
	}
	if route.model.ID != shown.model.ID {
		t.Fatalf("the call would be charged at row %q while the picker showed %q",
			route.model.Name, shown.model.Name)
	}
	if route.pricing.Input != shown.pricing.Input || route.pricing.Output != shown.pricing.Output {
		t.Fatalf("prices diverged: charged in/out %s/%s, shown %s/%s",
			route.pricing.Input, route.pricing.Output, shown.pricing.Input, shown.pricing.Output)
	}
	// The chosen provider's addresses come first; the other eligible provider's
	// follow as fallback, so a dead preferred provider does not take the model
	// down. The disabled provider contributes nothing.
	if len(route.endpoints) != 2 || route.endpoints[0].apiKey != "second-secret" || route.providers != 2 {
		t.Fatalf("the route does not lead with the chosen provider: providers=%d %+v", route.providers, route.endpoints)
	}
}

// Plain http is the operator's decision — many relays only speak it — so an
// http address across the network is used like any other. What the gateway
// will not do is dial a scheme that is not HTTP at all; such a row is skipped
// rather than fatal, and the provider's other addresses still serve.
func TestOnlyHTTPSchemesAreDialled(t *testing.T) {
	f := setup(t, "ftp://relay.example.com")
	if _, err := f.s.routeFor(context.Background(), "test-model"); err == nil {
		t.Fatal("a non-HTTP address was accepted as an upstream")
	}

	addEndpoint(t, f, "http://relay.example.com:3000/v1", "plain-http-secret", 1)
	addEndpoint(t, f, "https://relay.example.com/v1", "https-secret", 2)
	route, err := f.s.routeFor(context.Background(), "test-model")
	if err != nil {
		t.Fatal(err)
	}
	if len(route.endpoints) != 2 || route.endpoints[0].baseURL != "http://relay.example.com:3000/v1" {
		t.Fatalf("the usable addresses were not the ones kept: %+v", route.endpoints)
	}
}

// Several OpenAI-compatible clients decide how to treat a model from its id
// alone: a bare "gpt-5.2" or later is taken for an OpenAI model and handled
// differently, and no provider setting overrides that. The namespace this
// gateway advertises has to keep every id out of that rule.
func TestAdvertisedIDsAreNotMistakenForOpenAIModels(t *testing.T) {
	// The rule such clients apply: an id is OpenAI's only if it starts with
	// "gpt-", "openai/" or "codex/".
	openAIish := func(id string) bool {
		lower := strings.ToLower(strings.TrimSpace(id))
		return strings.HasPrefix(lower, "gpt-") ||
			strings.HasPrefix(lower, "openai/") ||
			strings.HasPrefix(lower, "codex/")
	}
	for _, key := range []string{"gpt-5.5", "gpt-5.2-pro", "gpt-4o", "o3-pro", "codex-mini-latest", "deepseek-chat"} {
		id := advertisedID(key)
		if openAIish(id) {
			t.Errorf("advertised %q still reads as an OpenAI model id", id)
		}
		if upstreamKey(id) != key {
			t.Errorf("upstreamKey(%q) = %q, want %q", id, upstreamKey(id), key)
		}
	}
	// A relay whose own keys are namespaced keeps its slashes.
	if got := upstreamKey(advertisedID("deepseek/deepseek-chat")); got != "deepseek/deepseek-chat" {
		t.Errorf("nested key mangled: %q", got)
	}
}

// A client may send either name. The provider is always called with its own.
func TestEitherModelNameWorksAndTheProviderSeesItsOwn(t *testing.T) {
	var seen string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Model string `json:"model"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		seen = body.Model
		fmt.Fprint(w, okWithUsage)
	}))
	defer upstream.Close()

	for _, name := range []string{"test-model", "flowinglight/test-model"} {
		seen = ""
		f := setup(t, upstream.URL)
		prompt := strings.Replace(testPrompt, `"test-model"`, `"`+name+`"`, 1)
		if prompt == testPrompt && name != "test-model" {
			t.Fatalf("the fixture prompt no longer names the model; cannot vary it")
		}
		w := f.request("POST", "/api/integrations/v1/chat/completions", prompt, f.apiKey, nil)
		if w.Code != 200 {
			t.Fatalf("%s was refused: %d %s", name, w.Code, w.Body.String())
		}
		if seen != "test-model" {
			t.Fatalf("the provider was called with %q, want its own key", seen)
		}
	}
}

// The catalogue advertises the namespaced id, so a client that copies an id
// from the list sends one the gateway recognises.
func TestTheCatalogueAdvertisesTheNamespacedID(t *testing.T) {
	f := setup(t, "")
	w := f.request("GET", "/api/integrations/v1/models", "", f.apiKey, nil)
	if w.Code != 200 {
		t.Fatalf("model list failed: %d %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), `"flowinglight/test-model"`) {
		t.Fatalf("the catalogue still advertises a bare id: %s", w.Body.String())
	}
}

// A request that is too big and one that is malformed are different problems
// for the user — fewer pictures fixes one, nothing they do fixes the other —
// so they must not share an error.
func TestTooLargeAndMalformedRequestsAreToldApart(t *testing.T) {
	f := setup(t, "")

	// Well-formed JSON, just past the cap: an image-laden message.
	filler := strings.Repeat("a", maxGatewayRequest+1024)
	huge := `{"model":"test-model","messages":[{"role":"user","content":"` + filler + `"}]}`
	w := f.request("POST", "/api/integrations/v1/chat/completions", huge, f.apiKey, nil)
	if w.Code != 413 || !strings.Contains(w.Body.String(), "request_too_large") {
		t.Fatalf("an oversized request was not reported as such: %d %s", w.Code, w.Body.String()[:min(200, w.Body.Len())])
	}
	if !strings.Contains(w.Body.String(), "64 MiB") {
		t.Fatalf("the message does not tell the user the limit: %s", w.Body.String())
	}

	w = f.request("POST", "/api/integrations/v1/chat/completions", `{"model": "test-model", "messages": [`, f.apiKey, nil)
	if w.Code != 400 || !strings.Contains(w.Body.String(), "invalid_request") {
		t.Fatalf("malformed JSON was not a 400: %d %s", w.Code, w.Body.String())
	}
	if strings.Contains(w.Body.String(), "大小") {
		t.Fatalf("malformed JSON was blamed on size: %s", w.Body.String())
	}

	// Neither refusal may move money: they happen before any reservation.
	var user model.User
	f.s.d.DB.First(&user, "id = ?", f.user.ID)
	if user.Points != 20 || user.PointHeldMicros != 0 {
		t.Fatalf("a refused request moved money: %+v", user)
	}
}
