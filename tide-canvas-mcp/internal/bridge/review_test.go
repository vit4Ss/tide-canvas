package bridge

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestInvalidPlacementAndBlankTextNeverReachPaidAPI(t *testing.T) {
	f, endpoint := setupServer(t)
	s := connect(t, endpoint, "key-a", "2026-07-28")
	for _, field := range []string{"videoUrls", "audioUrls", "mode", "parameters"} {
		args := map[string]any{"modelId": "vid", "clientRequestId": "wrong-placement", "prompt": "move", "parameters": map[string]any{field: []string{"https://cdn.test/ref.mp4"}}}
		if !call(t, s, "generate_video", args).IsError {
			t.Fatalf("misplaced %s was accepted", field)
		}
	}
	for _, tool := range []string{"generate_image", "generate_video"} {
		if !call(t, s, tool, map[string]any{"modelId": "m", "clientRequestId": "blank", "prompt": "  "}).IsError {
			t.Fatal("blank text generation accepted")
		}
	}
	// Mis-typed top-level references must fail schema validation, not silently
	// turn an intended image edit into a billed text-to-image generation.
	res, err := s.CallTool(context.Background(), &mcp.CallToolParams{Name: "generate_image", Arguments: map[string]any{"modelId": "img", "clientRequestId": "typo", "prompt": "edit", "image_urls": []string{"https://cdn.test/ref.png"}}})
	if err == nil && !res.IsError {
		t.Fatal("unknown reference parameter was ignored")
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.charges != 0 {
		t.Fatalf("invalid requests charged %d times", f.charges)
	}
}

func TestMalformedTaskResponsesDoNotInventProcessingState(t *testing.T) {
	for _, data := range []string{`null`, `{}`, `{"id":"900001"}`, `{"id":"900001","status":null}`, `{"id":"900001","status":9}`, `{"id":"0","status":0}`, `{"id":900001,"status":0}`, `{"id":"9999999999999999999","status":0}`} {
		if _, err := parseTask(json.RawMessage(data), ""); err == nil {
			t.Fatalf("invalid response accepted: %s", data)
		}
	}
	if _, err := parseTask(json.RawMessage(`{"id":"900002","status":1}`), "900001"); err == nil {
		t.Fatal("wrong task identity accepted")
	}
	for status := 0; status <= 3; status++ {
		task, err := parseTask(json.RawMessage(fmt.Sprintf(`{"id":"900001","status":%d}`, status)), "900001")
		if err != nil || task.Status != status {
			t.Fatalf("valid status %d rejected: %v", status, err)
		}
	}
}

func TestAmbiguousResponsesKeepRetryGuidanceWithoutAutoSubmitting(t *testing.T) {
	for _, data := range []string{`{"success":true,"data":null}`, `{"success":true,"data":{}}`, `{"success":true,"data":{"id":"900001"}}`, `{"success":true,"data":{"id":"900001","status":`} {
		t.Run(data, func(t *testing.T) {
			var calls atomic.Int32
			api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); _, _ = w.Write([]byte(data)) }))
			defer api.Close()
			c, _ := NewClient(api.URL)
			_, _, err := c.image(WithCredentials(context.Background(), Credentials{APIKey: "secret-key"}), nil, ImageInput{CommonInput: CommonInput{ModelID: "img", Prompt: "cat", ClientRequestID: "stable-id"}})
			if err == nil || !strings.Contains(err.Error(), "clientRequestId") || strings.Contains(err.Error(), "secret-key") {
				t.Fatalf("missing safe retry guidance: %v", err)
			}
			if calls.Load() != 1 {
				t.Fatal("bridge automatically resubmitted paid generation")
			}
		})
	}
}

func TestGatewayNonJSONErrorsPreserveStatusAndRetryAfter(t *testing.T) {
	for _, status := range []int{401, 403, 429, 503} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/api/mcp/config" {
					writeDefaultTestPolicy(w)
					return
				}
				w.Header().Set("Retry-After", "30")
				w.WriteHeader(status)
				_, _ = w.Write([]byte("<html>gateway error secret-key</html>"))
			}))
			defer api.Close()
			c, _ := NewClient(api.URL)
			handler, _ := NewHTTPHandler(c, nil)
			req := httptest.NewRequest(http.MethodPost, "http://localhost/mcp", strings.NewReader(`{}`))
			req.Header.Set("Authorization", "Bearer secret-key")
			out := httptest.NewRecorder()
			handler.ServeHTTP(out, req)
			if out.Code != status || out.Header().Get("Retry-After") != "30" {
				t.Fatalf("gateway error lost: %d %v", out.Code, out.Header())
			}
			if strings.Contains(out.Body.String(), "secret-key") {
				t.Fatal("gateway raw response leaked credentials")
			}
		})
	}
}

func TestConcurrentUsersAndReconnectKeepDistinctCredentials(t *testing.T) {
	f, endpoint := setupServer(t)
	a, b := connect(t, endpoint, "key-a", "2026-07-28"), connect(t, endpoint, "key-b", "2026-07-28")
	type outcome struct {
		owner  string
		result *mcp.CallToolResult
		err    error
	}
	results := make(chan outcome, 12)
	var wg sync.WaitGroup
	for i := 0; i < 6; i++ {
		for _, owner := range []string{"key-a", "key-b"} {
			wg.Add(1)
			go func(owner string) {
				defer wg.Done()
				s := a
				if owner == "key-b" {
					s = b
				}
				res, err := s.CallTool(context.Background(), &mcp.CallToolParams{Name: "generate_image", Arguments: map[string]any{"modelId": "img", "prompt": "same image", "clientRequestId": "same-concurrent-id"}})
				results <- outcome{owner, res, err}
			}(owner)
		}
	}
	wg.Wait()
	close(results)
	ids := map[string]string{}
	for result := range results {
		if result.err != nil {
			t.Fatal(result.err)
		}
		task := decodeOutput[TaskOutput](t, result.result)
		if id := ids[result.owner]; id != "" && id != task.Task.ID {
			t.Fatal("duplicate task for the same owner")
		}
		ids[result.owner] = task.Task.ID
	}
	if ids["key-a"] == ids["key-b"] {
		t.Fatal("concurrent user identity crossed")
	}
	// Rebuild the MCP server as after a restart; durable task/charging state is
	// entirely in the main site and must not depend on local MCP sessions.
	api := httptest.NewServer(f)
	defer api.Close()
	c, _ := NewClient(api.URL)
	handler, _ := NewHTTPHandler(c, nil)
	server := httptest.NewServer(handler)
	defer server.Close()
	reconnected := connect(t, server.URL, "key-a", "2026-07-28")
	if task := decodeOutput[TaskOutput](t, call(t, reconnected, "generate_image", map[string]any{"modelId": "img", "prompt": "same image", "clientRequestId": "same-concurrent-id"})); task.Task.ID != ids["key-a"] {
		t.Fatal("reconnect created a new task")
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.charges != 2 {
		t.Fatalf("charged %d times, want once per user", f.charges)
	}
}

func TestReferenceOnlyVideoAndLyricsAudioStillWork(t *testing.T) {
	_, endpoint := setupServer(t)
	s := connect(t, endpoint, "key-a", "2026-07-28")
	video := decodeOutput[TaskOutput](t, call(t, s, "generate_video", map[string]any{"modelId": "vid", "clientRequestId": "reference-only", "imageUrls": []string{"https://cdn.test/start.png"}}))
	if video.Task.Handler != "image_to_video" {
		t.Fatal("reference-only generation regressed")
	}
	audio := decodeOutput[TaskOutput](t, call(t, s, "generate_audio", map[string]any{"modelId": "audio", "clientRequestId": "lyrics-only", "parameters": map[string]any{"lyrics": "A song"}}))
	if audio.Task.Handler != "text_to_audio" {
		t.Fatal("lyrics-only generation regressed")
	}
}

func TestClientRejectsBaseURLThatWouldSwallowAPIPath(t *testing.T) {
	for _, base := range []string{"https://site.test?", "https://site.test/api", "https://site.test/api/", "https://site.test/api/open/v1"} {
		if _, err := NewClient(base); err == nil {
			t.Fatalf("bad base accepted: %s", base)
		}
	}
	for _, base := range []string{"http://127.0.0.1:8081", "https://site.test/", "https://site.test/app"} {
		if _, err := NewClient(base); err != nil {
			t.Fatalf("valid base rejected: %v", err)
		}
	}
}

func TestPreflightDoesNotAuthenticateOrCallMainSite(t *testing.T) {
	var calls atomic.Int32
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/mcp/config" {
			writeDefaultTestPolicy(w)
			return
		}
		calls.Add(1)
		w.WriteHeader(401)
	}))
	defer api.Close()
	c, _ := NewClient(api.URL)
	handler, _ := NewHTTPHandler(c, []string{"https://app.example.test"})
	server := httptest.NewServer(handler)
	defer server.Close()
	req, _ := http.NewRequest(http.MethodOptions, server.URL+"/mcp", nil)
	req.Header.Set("Origin", "https://app.example.test")
	req.Header.Set("Access-Control-Request-Method", "POST")
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = io.Copy(io.Discard, res.Body)
	res.Body.Close()
	if res.StatusCode != 204 || res.Header.Get("Access-Control-Allow-Origin") != "https://app.example.test" || calls.Load() != 0 {
		t.Fatal("preflight tried to authenticate or denied configured origin")
	}
}

func TestBusinessRejectionIsNotReportedAsUnknownSubmission(t *testing.T) {
	for _, code := range []int{2001, 2002, 2005, 2006} {
		api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			_ = json.NewEncoder(w).Encode(map[string]any{"success": false, "code": code, "message": "任务未受理"})
		}))
		c, _ := NewClient(api.URL)
		_, _, err := c.image(WithCredentials(context.Background(), Credentials{APIKey: "key-a"}), nil, ImageInput{CommonInput: CommonInput{ModelID: "img", Prompt: "cat", ClientRequestID: "rejected"}})
		api.Close()
		if err == nil || strings.Contains(err.Error(), "提交结果未确认") {
			t.Fatalf("business rejection %d was misclassified: %v", code, err)
		}
	}
}
