package lobehub

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/gin-gonic/gin"
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

	f := setup(t, "", primary.URL)
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
	if user.PointBalance() != 19.96 || user.PointHeldMicros != 0 {
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

	f := setup(t, "", first.URL)
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

	f := setup(t, "", dead.URL)
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

	f := setup(t, "", good.URL)
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
	f2 := setup(t, "", good.URL)
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

	f := setup(t, "", leaky.URL)
	w := f.request("POST", "/api/integrations/v1/chat/completions", testPrompt, f.apiKey, nil)
	// The gateway replaces an upstream error with its own wording, so the echoed
	// credential never reaches the caller in any form.
	if strings.Contains(w.Body.String(), "upstream-secret-only") {
		t.Fatalf("the upstream credential was forwarded to the caller: %s", w.Body.String())
	}
	if strings.Contains(w.Body.String(), "bad key") {
		t.Fatalf("raw upstream error text reached the caller: %s", w.Body.String())
	}
}

// offeredModels is what both the catalogue and the sync read, so a provider
// without any address must not appear as something a user can pick.
func TestRoutingReportsAProviderWithNoAddress(t *testing.T) {
	f := setup(t, "", "")
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
	f := setup(t, "", "")
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
	if len(route.endpoints) != 1 || route.endpoints[0].apiKey != "second-secret" {
		t.Fatalf("the route carries the wrong provider's addresses: %+v", route.endpoints)
	}
}

// The admin form only stores https, but the gateway calls whatever is in the
// table. A row that would put the operator's key on the wire in the clear is
// skipped rather than used.
func TestAPlaintextAddressNeverCarriesTheCredential(t *testing.T) {
	good := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, okWithUsage)
	}))
	defer good.Close()

	f := setup(t, "", "http://relay.example.com")
	if _, err := f.s.routeFor(context.Background(), "test-model"); err == nil {
		t.Fatal("a plain-http address across the network was used to carry the key")
	}

	// Loopback is the exception: nothing leaves the machine, which is what lets
	// a test server stand in for a provider.
	addEndpoint(t, f, good.URL, "loopback-secret", 1)
	route, err := f.s.routeFor(context.Background(), "test-model")
	if err != nil {
		t.Fatal(err)
	}
	if len(route.endpoints) != 1 || route.endpoints[0].baseURL != good.URL {
		t.Fatalf("wrong addresses survived the check: %+v", route.endpoints)
	}
}

// The login hop runs inside the chat iframe. A browser that renders the 302
// instead of following it used to show Go's default body — the bare word
// "Found" — and the user was stuck with nothing to click.
func TestTheLoginHopCarriesItsDestinationInTheBody(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest("GET", "/api/lobehub/oidc/authorize", nil)

	const target = "https://main.example.com/ai-chat/authorize?request=abc&x=1"
	redirectToLogin(c, target)

	if w.Code != 302 {
		t.Fatalf("status = %d, want 302 for clients that do follow it", w.Code)
	}
	if got := w.Header().Get("Location"); got != target {
		t.Fatalf("Location = %q, want %q", got, target)
	}
	body := w.Body.String()
	if strings.Contains(body, ">Found<") {
		t.Fatal("the body is still Go's default redirect text")
	}
	// The destination has to be reachable from the rendered page two ways.
	escaped := "https://main.example.com/ai-chat/authorize?request=abc&amp;x=1"
	if !strings.Contains(body, `content="0;url=`+escaped+`"`) {
		t.Fatalf("no meta refresh to the destination: %s", body)
	}
	if !strings.Contains(body, `href="`+escaped+`"`) {
		t.Fatalf("nothing for the user to click: %s", body)
	}
	// The destination is interpolated into HTML, so it must not be able to
	// close the attribute it sits in.
	hostile := httptest.NewRecorder()
	c2, _ := gin.CreateTestContext(hostile)
	c2.Request = httptest.NewRequest("GET", "/", nil)
	redirectToLogin(c2, `https://x/"><script>alert(1)</script>`)
	if strings.Contains(hostile.Body.String(), "<script>alert(1)</script>") {
		t.Fatalf("the destination broke out of its attribute: %s", hostile.Body.String())
	}
}

// LobeHub decides which OpenAI endpoint to call from the model id alone: a bare
// "gpt-5.2" or later is called through /v1/responses, which this gateway does
// not serve, and no provider setting overrides that. The namespace this gateway
// advertises has to keep every id out of that rule.
func TestAdvertisedIDsAreNotMistakenForOpenAIModels(t *testing.T) {
	// The rule LobeHub applies (packages/model-runtime/.../openai/modelId.ts):
	// an id is OpenAI's only if it starts with "gpt-", "openai/" or "codex/".
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
		f := setup(t, "", upstream.URL)
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

// The catalogue and the sync must advertise the same id, or the picker offers a
// model the gateway then refuses.
func TestTheCatalogueAdvertisesTheNamespacedID(t *testing.T) {
	f := setup(t, "", "")
	w := f.request("GET", "/api/integrations/v1/models", "", f.apiKey, nil)
	if w.Code != 200 {
		t.Fatalf("model list failed: %d %s", w.Code, w.Body.String())
	}
	if !strings.Contains(w.Body.String(), `"flowinglight/test-model"`) {
		t.Fatalf("the catalogue still advertises a bare id: %s", w.Body.String())
	}
}
