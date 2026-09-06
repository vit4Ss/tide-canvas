package lobehub

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"tidecanvas/internal/model"
)

// Two providers may both offer the same upstream model id. The catalogue shows
// one entry, and the call is billed at that entry's price — never at a second,
// differently priced row the user was never quoted.
func TestOneEntryAndOnePriceWhenProvidersShareAModelID(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"ok\"},\"finish_reason\":\"stop\"}]}\n\ndata: {\"choices\":[],\"usage\":{\"prompt_tokens\":100,\"completion_tokens\":100,\"total_tokens\":200}}\n\ndata: [DONE]\n\n")
	}))
	defer up.Close()
	f := setup(t, "", up.URL)

	// A second provider offering the same id, priced far higher, sorted after.
	other := model.ChatProvider{Name: "Backup Provider", Enabled: true, SortOrder: 5}
	if err := f.s.d.DB.Create(&other).Error; err != nil {
		t.Fatal(err)
	}
	sealed, err := f.s.upstreams.Seal("other-secret")
	if err != nil {
		t.Fatal(err)
	}
	if err := f.s.d.DB.Create(&model.ChatEndpoint{ProviderID: other.ID, BaseURL: up.URL, APIKey: sealed, Enabled: true}).Error; err != nil {
		t.Fatal(err)
	}
	dearer := strings.ReplaceAll(tokenTestPricing, `"300"`, `"9000"`)
	if err := f.s.d.DB.Create(&model.ChatModel{ProviderID: other.ID, ModelKey: "test-model", Name: "Same id, dearer", Enabled: true, SortOrder: 5, Pricing: dearer}).Error; err != nil {
		t.Fatal(err)
	}

	models := jsonMap(t, f.request("GET", "/api/integrations/v1/models", "", f.apiKey, nil))["data"].([]any)
	if len(models) != 1 {
		t.Fatalf("a shared model id produced %d catalogue entries", len(models))
	}
	quoted := models[0].(map[string]any)["token_pricing"].(map[string]any)["outputPointsPerMillion"]
	if quoted != "300" {
		t.Fatalf("quoted the wrong price: %v", quoted)
	}

	if w := f.request("POST", "/api/integrations/v1/chat/completions", testPrompt, f.apiKey, nil); w.Code != 200 {
		t.Fatalf("call failed: %d %s", w.Code, w.Body.String())
	}
	// 100 input at 100/M + 100 output at 300/M = 0.04 — the quoted price.
	var user model.User
	f.s.d.DB.First(&user, "id = ?", f.user.ID)
	if user.PointBalance() != 19.96 {
		t.Fatalf("charged at a price the user was not quoted: %v", user.PointBalance())
	}
}
func TestInterruptedTerminalChunkRetainsContentAndReplay(t *testing.T) {
	for _, stream := range []bool{true, false} {
		t.Run(fmt.Sprint(stream), func(t *testing.T) {
			var calls atomic.Int32
			up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				fmt.Fprint(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"last words\"},\"finish_reason\":\"length\"}]}\n\ndata: {\"choices\":[],\"usage\":{\"prompt_tokens\":100,\"completion_tokens\":100,\"total_tokens\":200}}\n\ndata: [DONE]\n\n")
			}))
			defer up.Close()
			f := setup(t, "", up.URL)
			body := fmt.Sprintf(`{"model":"test-model","stream":%t,"messages":[{"role":"user","content":"hi"}]}`, stream)
			for retry := 0; retry < 2; retry++ {
				w := f.request("POST", "/api/integrations/v1/chat/completions", body, f.apiKey, map[string]string{"Idempotency-Key": "partial-terminal"})
				if !strings.Contains(w.Body.String(), "last words") {
					t.Errorf("partial content lost, stream=%t retry=%d: %s", stream, retry, w.Body.String())
				}
				if !strings.Contains(w.Body.String(), `"error"`) {
					t.Error("partial output incorrectly presented as success")
				}
				if stream && strings.Contains(w.Body.String(), `"finish_reason":"length"`) {
					t.Error("premature finish marker emitted before the error")
				}
			}
			var user model.User
			f.s.d.DB.First(&user, "id = ?", f.user.ID)
			if user.PointBalance() != 19.96 || user.PointHeldMicros != 0 || calls.Load() != 1 {
				t.Fatalf("partial response replay charged twice: balance=%v held=%d calls=%d",
					user.PointBalance(), user.PointHeldMicros, calls.Load())
			}
		})
	}
}

func TestChunkedLaunchStillChecksExpectedAccount(t *testing.T) {
	f := setup(t, "", "")
	request := httptest.NewRequest("POST", "/api/lobehub/launch", strings.NewReader(`{"accountId":"another-account"}`))
	request.ContentLength = -1
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+f.jwt)
	w := httptest.NewRecorder()
	f.router.ServeHTTP(w, request)
	if result := jsonMap(t, w); result["code"] != float64(409) {
		t.Fatalf("chunked account guard bypassed: %s", w.Body.String())
	}
	var count int64
	f.s.d.DB.Model(&model.LobeHubGrant{}).Count(&count)
	if count != 0 {
		t.Fatal("mismatched account obtained a launch ticket")
	}
}

func TestConcurrentBindingCannotOverwriteRotatedKey(t *testing.T) {
	var owner string
	var writes atomic.Int32
	var configured atomic.Value
	entered, release := make(chan struct{}), make(chan struct{})
	lobe := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/api/auth/get-session":
			fmt.Fprint(w, `{"user":{"id":"concurrent-user"}}`)
		case "/api/auth/list-accounts":
			fmt.Fprintf(w, `[{"providerId":"generic-oidc","accountId":"%s"}]`, owner)
		case "/trpc/lambda/agent.getBuiltinAgent":
			fmt.Fprint(w, `{"result":{"data":{"json":{"id":"inbox"}}}}`)
		default:
			if strings.HasSuffix(r.URL.Path, "updateAiProviderConfig") {
				var input map[string]any
				_ = json.NewDecoder(r.Body).Decode(&input)
				key := input["json"].(map[string]any)["value"].(map[string]any)["keyVaults"].(map[string]any)["apiKey"].(string)
				if writes.Add(1) == 1 {
					close(entered)
					<-release
				}
				configured.Store(key)
			}
			fmt.Fprint(w, `{"result":{"data":{"json":null}}}`)
		}
	}))
	defer lobe.Close()
	f := setup(t, lobe.URL, "")
	owner = f.user.ID.String()
	ticket := func() string {
		result := f.request("POST", "/api/lobehub/launch", fmt.Sprintf(`{"accountId":"%s"}`, owner), f.jwt, nil)
		location := jsonMap(t, result)["data"].(map[string]any)["url"].(string)
		u, _ := url.Parse(location)
		return u.Query().Get("ticket")
	}
	headers := map[string]string{"Origin": lobe.URL, "Cookie": "session=concurrent"}
	firstTicket, secondTicket := ticket(), ticket()
	first := make(chan *httptest.ResponseRecorder, 1)
	go func() { first <- f.request("POST", "/api/lobehub/bind", `{"ticket":"`+firstTicket+`"}`, "", headers) }()
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		close(release)
		t.Fatal("binding never started")
	}
	key, _ := f.s.d.UserKeys.Ensure(context.Background(), f.user.ID)
	rotated, err := f.s.d.UserKeys.Change(context.Background(), f.user.ID, key.Revision, true, true)
	if err != nil {
		close(release)
		t.Fatal(err)
	}
	second := f.request("POST", "/api/lobehub/bind", `{"ticket":"`+secondTicket+`"}`, "", headers)
	close(release)
	firstResult := <-first
	if second.Code != 409 || !strings.Contains(second.Body.String(), "SYNC_IN_PROGRESS") {
		t.Fatalf("simultaneous credential writes allowed: %d %s", second.Code, second.Body.String())
	}
	if firstResult.Code != 409 {
		t.Fatal("rotation during synchronization was not detected")
	}
	retry := f.request("POST", "/api/lobehub/bind", `{"ticket":"`+secondTicket+`"}`, "", headers)
	if retry.Code != 200 {
		t.Fatalf("busy request lost its retry ticket: %s", retry.Body.String())
	}
	want, _ := f.s.d.UserKeys.Reveal(context.Background(), f.user.ID, rotated.Revision)
	if configured.Load() != want {
		t.Fatal("old request overwrote the new credential")
	}
}
