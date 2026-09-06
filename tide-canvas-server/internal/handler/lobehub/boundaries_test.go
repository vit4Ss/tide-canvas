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
	"time"

	"tidecanvas/internal/model"
)

const testPrompt = `{"model":"test-model","messages":[{"role":"user","content":"hello"}]}`

func TestGatewayConcurrentReservationAndDailyLimit(t *testing.T) {
	entered, release := make(chan struct{}), make(chan struct{})
	var calls atomic.Int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		close(entered)
		<-release
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"ok\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n")
	}))
	defer up.Close()
	f := setup(t, "", up.URL)
	f.s.cfg.MaxConcurrent = 1
	f.s.cfg.DailyLimit = 1
	first := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		first <- f.request("POST", "/api/integrations/v1/chat/completions", testPrompt, f.apiKey, map[string]string{"Idempotency-Key": "first"})
	}()
	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		close(release)
		t.Fatal("upstream never entered")
	}
	busy := f.request("POST", "/api/integrations/v1/chat/completions", testPrompt, f.apiKey, nil)
	replay := f.request("POST", "/api/integrations/v1/chat/completions", testPrompt, f.apiKey, map[string]string{"Idempotency-Key": "first"})
	close(release)
	if busy.Code != 429 || replay.Code != 409 || calls.Load() != 1 {
		t.Fatalf("concurrent request charged or started twice: busy=%d replay=%d calls=%d", busy.Code, replay.Code, calls.Load())
	}
	if result := <-first; result.Code != 200 {
		t.Fatal(result.Body.String())
	}
	limited := f.request("POST", "/api/integrations/v1/chat/completions", testPrompt, f.apiKey, nil)
	if limited.Code != 429 || !strings.Contains(limited.Body.String(), "daily_limit") {
		t.Fatal(limited.Body.String())
	}
	var user model.User
	f.s.d.DB.First(&user, "id = ?", f.user.ID)
	if user.Points != 17 {
		t.Fatalf("wrong final balance: %d", user.Points)
	}
}

func TestGatewayToolCycleAndInvalidInputs(t *testing.T) {
	var received map[string]any
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&received)
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_next\",\"type\":\"function\",\"function\":{\"name\":\"search\",\"arguments\":\"{\\\"q\\\":\"}}]}}]}\n\n")
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"\\\"answer\\\"}\"}}]},\"finish_reason\":\"tool_calls\"}]}\n\ndata: [DONE]\n\n")
	}))
	defer up.Close()
	f := setup(t, "", up.URL)
	f.s.cfg.SupportsTools = true
	body := `{"model":"test-model","tools":[{"type":"function","function":{"name":"search","parameters":{"type":"object"}}}],"messages":[{"role":"system","content":"rules"},{"role":"user","content":"find"},{"role":"assistant","tool_calls":[{"id":"call_previous","type":"function","function":{"name":"search","arguments":"{}"}}]},{"role":"tool","tool_call_id":"call_previous","content":"result"}]}`
	w := f.request("POST", "/api/integrations/v1/chat/completions", body, f.apiKey, nil)
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	result := jsonMap(t, w)
	choice := result["choices"].([]any)[0].(map[string]any)
	if choice["finish_reason"] != "tool_calls" {
		t.Fatal(result)
	}
	call := choice["message"].(map[string]any)["tool_calls"].([]any)[0].(map[string]any)
	if call["function"].(map[string]any)["arguments"] != `{"q":"answer"}` {
		t.Fatal(call)
	}
	if len(received["messages"].([]any)) != 4 || received["tools"] == nil {
		t.Fatal("current tool cycle or tool definitions lost")
	}
	for _, invalid := range []string{testPrompt + " {}", `{"model":"test-model","messages":[]}`, `{"model":"not-available","messages":[{"role":"user","content":"x"}]}`} {
		w = f.request("POST", "/api/integrations/v1/chat/completions", invalid, f.apiKey, nil)
		if w.Code < 400 {
			t.Fatal("invalid request accepted")
		}
	}
	var user model.User
	f.s.d.DB.First(&user, "id = ?", f.user.ID)
	if user.Points != 17 {
		t.Fatal("invalid input charged")
	}
}

func TestGatewaySettlementRecoveryAndReplayConflict(t *testing.T) {
	f := setup(t, "", "")
	var m model.MarketModel
	f.s.d.DB.First(&m)
	row, fresh, err := f.s.reserve(context.Background(), f.user.ID, "reserved", "body", m)
	if err != nil || !fresh {
		t.Fatal(err)
	}
	if _, _, err := f.s.reserve(context.Background(), f.user.ID, "reserved", "different", m); err != errReplayConflict {
		t.Fatal("request body conflict ignored")
	}
	if err := f.s.settle(row, "", "worker_interrupted"); err != nil {
		t.Fatal(err)
	}
	if err := f.s.settle(row, "", "worker_interrupted"); err != nil {
		t.Fatal(err)
	}
	var user model.User
	f.s.d.DB.First(&user, "id = ?", f.user.ID)
	if user.Points != 20 {
		t.Fatalf("recovery did not refund exactly once: %d", user.Points)
	}
	key, _ := f.s.d.UserKeys.Ensure(context.Background(), f.user.ID)
	f.s.d.DB.Model(key).Update("disabled_at", time.Now())
	w := f.request("POST", "/api/integrations/v1/chat/completions", testPrompt, f.apiKey, nil)
	if w.Code != 401 {
		t.Fatalf("disabled key accepted: %d %s", w.Code, w.Body.String())
	}
}

func TestSessionGuardRevalidatesMainIdentity(t *testing.T) {
	var subject string
	var unavailable bool
	lobe := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if unavailable {
			w.WriteHeader(503)
			return
		}
		if r.URL.Path == "/api/auth/get-session" {
			fmt.Fprint(w, `{"user":{"id":"lobe-guard-user"}}`)
			return
		}
		_ = json.NewEncoder(w).Encode([]any{map[string]any{"providerId": "generic-oidc", "accountId": subject}})
	}))
	defer lobe.Close()
	f := setup(t, lobe.URL, "")
	subject = f.user.ID.String()
	now := time.Now()
	f.s.d.DB.Create(&model.LobeHubLink{UserID: f.user.ID, LobeUserID: "lobe-guard-user", ConnectedAt: &now})
	check := func() int {
		return f.request("GET", "/api/lobehub/session-check", "", "", map[string]string{"Cookie": "session=guard"}).Code
	}
	if got := check(); got != 204 {
		t.Fatalf("valid linked session denied: %d", got)
	}
	subject = "another-account"
	if check() != 403 {
		t.Fatal("wrong OIDC subject accepted")
	}
	subject = f.user.ID.String()
	f.s.d.DB.Model(&model.User{}).Where("id = ?", f.user.ID).Update("status", 0)
	if check() != 403 {
		t.Fatal("disabled main account accepted")
	}
	unavailable = true
	if check() != 503 {
		t.Fatal("transient identity service failure treated as logout")
	}
}

// The chat is embedded by the main site, so the bridge must name it as the one
// allowed ancestor — and must not also send a blanket X-Frame-Options, which
// has no origin list and would block the embed outright.
func TestBridgeIsFramableOnlyByTheMainSite(t *testing.T) {
	f := setup(t, "", "")
	w := f.request("GET", "/api/lobehub/bridge?ticket="+strings.Repeat("t", 43), "", "", nil)
	if w.Code != 200 {
		t.Fatalf("bridge failed: %d %s", w.Code, w.Body.String())
	}
	if got := w.Header().Get("X-Frame-Options"); got != "" {
		t.Fatalf("X-Frame-Options %q overrides frame-ancestors and blocks the embed", got)
	}
	csp := w.Header().Get("Content-Security-Policy")
	if !strings.Contains(csp, "frame-ancestors "+f.s.mainOrigin+";") {
		t.Fatalf("the main site is not an allowed ancestor: %s", csp)
	}
	for _, forbidden := range []string{"frame-ancestors *", "frame-ancestors 'self'", "frame-ancestors 'none'"} {
		if strings.Contains(csp, forbidden) {
			t.Fatalf("%q would let any site embed the bridge or block the main one: %s", forbidden, csp)
		}
	}
}
