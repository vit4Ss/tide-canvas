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
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"ok\"},\"finish_reason\":\"stop\"}]}\n\ndata: {\"choices\":[],\"usage\":{\"prompt_tokens\":100,\"completion_tokens\":100,\"total_tokens\":200}}\n\ndata: [DONE]\n\n")
	}))
	defer up.Close()
	f := setup(t, up.URL)
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
	if user.PointBalance() != 19 || user.PointHeldMicros != 0 {
		t.Fatalf("wrong final balance: %v held=%d", user.PointBalance(), user.PointHeldMicros)
	}
}

func TestGatewayToolCycleAndInvalidInputs(t *testing.T) {
	var received map[string]any
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&received)
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_next\",\"type\":\"function\",\"function\":{\"name\":\"search\",\"arguments\":\"{\\\"q\\\":\"}}]}}]}\n\n")
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"\\\"answer\\\"}\"}}]},\"finish_reason\":\"tool_calls\"}]}\n\ndata: {\"choices\":[],\"usage\":{\"prompt_tokens\":100,\"completion_tokens\":100,\"total_tokens\":200}}\n\ndata: [DONE]\n\n")
	}))
	defer up.Close()
	f := setup(t, up.URL)
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
	// Only what the gateway itself must refuse: a body that is not one JSON
	// object, and a model it does not offer. An empty message list is the
	// provider's to judge now, and its answer is passed through.
	for _, invalid := range []string{testPrompt + " {}", `{"model":"not-available","messages":[{"role":"user","content":"x"}]}`} {
		w = f.request("POST", "/api/integrations/v1/chat/completions", invalid, f.apiKey, nil)
		if w.Code < 400 {
			t.Fatal("invalid request accepted")
		}
	}
	var user model.User
	f.s.d.DB.First(&user, "id = ?", f.user.ID)
	if user.PointBalance() != 19 || user.PointHeldMicros != 0 {
		t.Fatalf("invalid input charged or left a reservation: %v held=%d", user.PointBalance(), user.PointHeldMicros)
	}
}

func TestGatewaySettlementRecoveryAndReplayConflict(t *testing.T) {
	f := setup(t, "")
	route, err := f.s.routeFor(context.Background(), "test-model")
	if err != nil {
		t.Fatal(err)
	}
	row, fresh, err := f.s.reserve(context.Background(), f.user.ID, "reserved", "body", route)
	if err != nil || !fresh {
		t.Fatal(err)
	}
	if _, _, err := f.s.reserve(context.Background(), f.user.ID, "reserved", "different", route); err != errReplayConflict {
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
