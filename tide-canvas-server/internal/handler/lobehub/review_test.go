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

	"github.com/shopspring/decimal"
	"tidecanvas/internal/model"
)

func TestGatewayChargeMatchesDisplayedModelWhenKeysAreDuplicated(t *testing.T) {
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"ok\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
	}))
	defer up.Close()
	f := setup(t, "", up.URL)
	if err := f.s.d.DB.Create(&model.MarketModel{Name: "Preferred model", ModelKey: "test-model", Type: "text", Status: 1, SortOrder: -1, Price: decimal.NewFromInt(7)}).Error; err != nil {
		t.Fatal(err)
	}
	w := f.request("GET", "/api/integrations/v1/models", "", f.apiKey, nil)
	models := jsonMap(t, w)["data"].([]any)
	if len(models) != 1 || models[0].(map[string]any)["point_cost"] != float64(7) {
		t.Fatal("wrong displayed model")
	}
	w = f.request("POST", "/api/integrations/v1/chat/completions", testPrompt, f.apiKey, nil)
	if w.Code != 200 || w.Header().Get("X-Point-Cost") != "7" {
		t.Fatalf("charged a different duplicate model: %d %s", w.Code, w.Header().Get("X-Point-Cost"))
	}
	var user model.User
	f.s.d.DB.First(&user, "id = ?", f.user.ID)
	if user.Points != 13 {
		t.Fatalf("quoted 7 points but charged %d", 20-user.Points)
	}
}

func TestInterruptedTerminalChunkRetainsContentAndReplay(t *testing.T) {
	for _, stream := range []bool{true, false} {
		t.Run(fmt.Sprint(stream), func(t *testing.T) {
			var calls atomic.Int32
			up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				fmt.Fprint(w, "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"last words\"},\"finish_reason\":\"length\"}]}\n\ndata: [DONE]\n\n")
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
			if user.Points != 17 || calls.Load() != 1 {
				t.Fatal("partial response replay charged twice")
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
