package lobehub

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"tidecanvas/internal/model"
)

// The gateway exists to swap in the operator's credential and to bill by
// usage. Everything else about a chat call belongs to LobeHub and the
// provider: the request goes up as built, and the provider's own answer comes
// back down when it objects.

const untrimmedPrompt = `{"model":"test-model","stream":false,"messages":[{"role":"user","content":"hi"}]}`

// A provider that objects to the request is answered with the provider's own
// words, at once. Every address would refuse the same request the same way, so
// a retry elsewhere only repeats the failure and hides the reason — and the
// address is not at fault, so its health is left alone.
func TestAProviderObjectionIsPassedThroughWithoutFailover(t *testing.T) {
	var backupCalls atomic.Int32
	primary := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(400)
		fmt.Fprint(w, `{"error":{"message":"This model does not support image input. (key upstream-secret-only)","type":"invalid_request_error"}}`)
	}))
	defer primary.Close()
	backup := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		backupCalls.Add(1)
		fmt.Fprint(w, okWithUsage)
	}))
	defer backup.Close()

	f := setup(t, "", primary.URL)
	addEndpoint(t, f, backup.URL, "backup-secret", 1)

	w := f.request("POST", "/api/integrations/v1/chat/completions", untrimmedPrompt, f.apiKey, nil)
	if w.Code != 400 {
		t.Fatalf("status = %d, want the provider's own 400: %s", w.Code, w.Body.String())
	}
	body := w.Body.String()
	if !strings.Contains(body, "This model does not support image input") {
		t.Fatalf("the provider's reason was replaced with a paraphrase: %s", body)
	}
	if strings.Contains(body, "upstream-secret-only") || !strings.Contains(body, "[REDACTED]") {
		t.Fatalf("the operator's credential reached the user: %s", body)
	}
	if backupCalls.Load() != 0 {
		t.Fatal("a request the provider objected to was retried on the backup address")
	}
	var user model.User
	f.s.d.DB.First(&user, "id = ?", f.user.ID)
	if user.Points != 20 || user.PointHeldMicros != 0 {
		t.Fatalf("a refused request moved money: %+v", user)
	}
	var endpoints []model.ChatEndpoint
	f.s.d.DB.Find(&endpoints)
	for _, e := range endpoints {
		if e.LastFailure != "" {
			t.Fatalf("a request problem was recorded against the address: %q", e.LastFailure)
		}
	}
}

// The same objection over a stream: the headers are already out, so it rides in
// the final error frame, with the provider's status alongside for anyone who
// opens the details.
func TestAProviderObjectionReachesAStreamingClient(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(422)
		fmt.Fprint(w, `{"error":{"message":"temperature must be between 0 and 2"}}`)
	}))
	defer upstream.Close()

	f := setup(t, "", upstream.URL)
	prompt := strings.Replace(untrimmedPrompt, `"stream":false`, `"stream":true`, 1)
	w := f.request("POST", "/api/integrations/v1/chat/completions", prompt, f.apiKey, nil)
	body := w.Body.String()
	if !strings.Contains(body, "temperature must be between 0 and 2") {
		t.Fatalf("the provider's reason did not reach the stream: %s", body)
	}
	if !strings.Contains(body, `"upstream_status":422`) {
		t.Fatalf("the provider's status was not reported: %s", body)
	}
	if !strings.HasSuffix(strings.TrimSpace(body), "data: [DONE]") {
		t.Fatalf("the stream was not closed properly after the error: %s", body)
	}
}

// A refusal that is about the address — a bad key, a quota — still moves the
// call to the next address. Only when every address refuses does the user see
// it, and then it is the provider's reason, not a generic one.
func TestWhenEveryAddressRefusesTheProviderReasonIsShown(t *testing.T) {
	var calls atomic.Int32
	dead := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.WriteHeader(401)
		fmt.Fprint(w, `{"error":{"message":"Incorrect API key provided","code":"invalid_api_key"}}`)
	}))
	defer dead.Close()

	f := setup(t, "", dead.URL)
	addEndpoint(t, f, dead.URL, "another-secret", 1)

	w := f.request("POST", "/api/integrations/v1/chat/completions", untrimmedPrompt, f.apiKey, nil)
	if calls.Load() != 2 {
		t.Fatalf("an address-level refusal did not fail over: %d call(s)", calls.Load())
	}
	if w.Code != 401 || !strings.Contains(w.Body.String(), "Incorrect API key provided") {
		t.Fatalf("the provider's reason was hidden: %d %s", w.Code, w.Body.String())
	}
	var user model.User
	f.s.d.DB.First(&user, "id = ?", f.user.ID)
	if user.Points != 20 || user.PointHeldMicros != 0 {
		t.Fatalf("a refused request moved money: %+v", user)
	}
}

// What LobeHub built is what the provider gets. The history is not trimmed,
// tools and n are not policed, and the only field this gateway touches is the
// output cap — clamped to what the model is priced for, never refused.
func TestTheRequestReachesTheProviderAsTheClientBuiltIt(t *testing.T) {
	var got map[string]any
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &got)
		fmt.Fprint(w, okWithUsage)
	}))
	defer upstream.Close()

	f := setup(t, "", upstream.URL)
	route, err := f.s.routeFor(t.Context(), "test-model")
	if err != nil {
		t.Fatal(err)
	}

	messages := []any{map[string]any{"role": "system", "content": "be brief"}}
	for i := 0; i < 12; i++ {
		role := "user"
		if i%2 == 1 {
			role = "assistant"
		}
		messages = append(messages, map[string]any{"role": role, "content": fmt.Sprintf("turn %d", i)})
	}
	request, _ := json.Marshal(map[string]any{
		"model":       "test-model",
		"stream":      false,
		"messages":    messages,
		"n":           1,
		"temperature": 0.3,
		"tools":       []any{map[string]any{"type": "function", "function": map[string]any{"name": "lookup", "parameters": map[string]any{"type": "object"}}}},
		"max_tokens":  999_999_999,
	})
	w := f.request("POST", "/api/integrations/v1/chat/completions", string(request), f.apiKey, nil)
	if w.Code != 200 {
		t.Fatalf("a well-formed request was refused: %d %s", w.Code, w.Body.String())
	}

	if sent, _ := got["messages"].([]any); len(sent) != 13 {
		t.Fatalf("the history was trimmed: provider saw %d of 13 messages", len(sent))
	}
	if tools, _ := got["tools"].([]any); len(tools) != 1 {
		t.Fatalf("tools did not reach the provider: %v", got["tools"])
	}
	if got["n"] != float64(1) || got["temperature"] != 0.3 {
		t.Fatalf("client parameters were altered: n=%v temperature=%v", got["n"], got["temperature"])
	}
	if got["max_tokens"] != float64(route.pricing.MaxOutput) {
		t.Fatalf("max_tokens = %v, want clamped to the priced cap %d", got["max_tokens"], route.pricing.MaxOutput)
	}
	if _, both := got["max_completion_tokens"]; both {
		t.Fatal("the cap was sent on both fields")
	}
	options, _ := got["stream_options"].(map[string]any)
	if got["stream"] != true || options["include_usage"] != true {
		t.Fatalf("usage reporting was not requested: stream=%v options=%v", got["stream"], got["stream_options"])
	}
	if got["model"] != "test-model" {
		t.Fatalf("the provider was called with %v, want its own model key", got["model"])
	}
}
