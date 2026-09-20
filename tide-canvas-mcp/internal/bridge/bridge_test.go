package bridge

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type fixture struct {
	mu       sync.Mutex
	charges  int
	disabled bool
	last     map[string]any
	jobs     map[string]Task
	owners   map[string]string
	requests map[string]string
}

func (f *fixture) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	if r.URL.Path == "/api/mcp/config" {
		writeDefaultTestPolicy(w)
		return
	}
	key := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if f.disabled || (key != "key-a" && key != "key-b") {
		w.WriteHeader(401)
		_, _ = w.Write([]byte(`{"error":{"message":"invalid key"}}`))
		return
	}
	if r.URL.Path == "/api/integrations/identity" {
		_ = json.NewEncoder(w).Encode(Identity{UserID: key, Points: 100 - int64(f.charges*3)})
		return
	}
	ok := func(data any) {
		_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "code": 200, "data": data})
	}
	fail := func(code int, msg string) {
		_ = json.NewEncoder(w).Encode(map[string]any{"success": false, "code": code, "message": msg})
	}
	switch {
	case r.URL.Path == "/api/open/v1/files/import":
		ok(map[string]any{"id": "7001", "fileUrl": "https://flowlight.example/uploads/7001.mp4", "originalName": "clip.mp4", "fileType": "video", "mimeType": "video/mp4", "fileSize": 123})
	case r.URL.Path == "/api/open/v1/files/upload-ticket":
		ok(map[string]any{"uploadPath": "/api/open/v1/files/upload-with-ticket", "authorization": "Upload root-ticket", "expiresAt": "2030-01-01T00:00:00Z", "expectedSize": 123, "originalName": "clip.mp4", "contentType": "video/mp4", "fileType": "video"})
	case r.URL.Path == "/api/open/v1/models":
		ok([]Model{{ModelID: "img", Name: "Image", Type: "image", Config: `{"resolutions":["4k"]}`}, {ModelID: "vid", Type: "video"}, {ModelID: "audio", Type: "audio"}, {ModelID: "text", Type: "text"}})
	case r.URL.Path == "/api/open/v1/generations":
		var input map[string]any
		if json.NewDecoder(r.Body).Decode(&input) != nil {
			w.WriteHeader(400)
			return
		}
		f.last = input
		if input["modelId"] == "no-points" {
			fail(2001, "积分不足")
			return
		}
		requestID := key + ":" + fmt.Sprint(input["clientRequestId"])
		if id := f.requests[requestID]; id != "" {
			ok(f.jobs[id])
			return
		}
		f.charges++
		id := fmt.Sprint(900000 + f.charges)
		task := Task{ID: id, Handler: fmt.Sprint(input["handler"]), Status: 0, Progress: 5, PointCost: 3, IsAPICall: true, Input: input["input"], ResultMeta: map[string]any{}}
		f.jobs[id], f.owners[id], f.requests[requestID] = task, key, id
		ok(task)
	case strings.HasPrefix(r.URL.Path, "/api/open/v1/tasks/"):
		id := strings.TrimPrefix(r.URL.Path, "/api/open/v1/tasks/")
		if f.owners[id] != key {
			w.WriteHeader(403)
			fail(403, "not allowed")
			return
		}
		ok(f.jobs[id])
	case r.URL.Path == "/api/open/v1/tasks":
		rows := []Task{}
		for id, task := range f.jobs {
			if f.owners[id] == key {
				rows = append(rows, task)
			}
		}
		ok(map[string]any{"records": rows, "total": len(rows)})
	default:
		w.WriteHeader(404)
		fail(404, "not found")
	}
}

type bearerTransport struct{ key string }

func writeDefaultTestPolicy(w http.ResponseWriter) {
	_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "data": Policy{Enabled: true, ImageEnabled: true, VideoEnabled: true, AudioEnabled: true, PublicURL: "https://flowlight.example/mcp", SchemaVersion: 1, AllowedOrigins: []string{}, PollIntervalSeconds: 5}})
}

func (b bearerTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	r = r.Clone(r.Context())
	r.Header.Set("Authorization", "Bearer "+b.key)
	return http.DefaultTransport.RoundTrip(r)
}

func setupServer(t *testing.T) (*fixture, string) {
	t.Helper()
	f := &fixture{jobs: map[string]Task{}, owners: map[string]string{}, requests: map[string]string{}}
	upstream := httptest.NewServer(f)
	t.Cleanup(upstream.Close)
	client, err := NewClient(upstream.URL)
	if err != nil {
		t.Fatal(err)
	}
	h, err := NewHTTPHandler(client, []string{"https://app.example.test"})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(h)
	t.Cleanup(server.Close)
	return f, server.URL
}

func connect(t *testing.T, endpoint, key, version string) *mcp.ClientSession {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	t.Cleanup(cancel)
	client := mcp.NewClient(&mcp.Implementation{Name: "integration-test", Version: "1"}, nil)
	session, err := client.Connect(ctx, &mcp.StreamableClientTransport{Endpoint: endpoint + "/mcp", HTTPClient: &http.Client{Transport: bearerTransport{key: key}}}, &mcp.ClientSessionOptions{ProtocolVersion: version})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = session.Close() })
	return session
}

func call(t *testing.T, s *mcp.ClientSession, name string, args any) *mcp.CallToolResult {
	t.Helper()
	res, err := s.CallTool(context.Background(), &mcp.CallToolParams{Name: name, Arguments: args})
	if err != nil {
		t.Fatal(err)
	}
	return res
}
func decodeOutput[T any](t *testing.T, result *mcp.CallToolResult) T {
	t.Helper()
	if result.IsError {
		t.Fatalf("tool error: %+v", result.Content)
	}
	data, err := json.Marshal(result.StructuredContent)
	if err != nil {
		t.Fatal(err)
	}
	var out T
	if err = json.Unmarshal(data, &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func TestMCPProtocolsGenerationAndOwnerIsolation(t *testing.T) {
	for _, version := range []string{"2025-11-25", "2026-07-28"} {
		t.Run(version, func(t *testing.T) {
			f, endpoint := setupServer(t)
			a := connect(t, endpoint, "key-a", version)
			b := connect(t, endpoint, "key-b", version)
			listed, err := a.ListTools(context.Background(), &mcp.ListToolsParams{})
			if err != nil {
				t.Fatal(err)
			}
			if len(listed.Tools) != 9 {
				t.Fatalf("tools=%d", len(listed.Tools))
			}
			for _, tool := range listed.Tools {
				if strings.HasPrefix(tool.Name, "generate_") && (tool.Annotations.ReadOnlyHint || !tool.Annotations.IdempotentHint) {
					t.Fatal("generation annotations are incorrect")
				}
			}
			asset := decodeOutput[SkillAssetRecord](t, call(t, a, "import_asset_url", ImportSkillAssetInput{URL: "https://cdn.test/clip.mp4", Type: "video"}))
			if asset.ID != "7001" || asset.URL == "" {
				t.Fatalf("root MCP import=%+v", asset)
			}
			upload := decodeOutput[SkillAssetUploadPlan](t, call(t, a, "prepare_asset_upload", PrepareSkillAssetUploadInput{Filename: "clip.mp4", ContentType: "video/mp4", Type: "video", Size: 123, SHA256: strings.Repeat("a", 64)}))
			if upload.UploadURL != "https://flowlight.example/api/open/v1/files/upload-with-ticket" || upload.Authorization != "Upload root-ticket" {
				t.Fatalf("root MCP upload=%+v", upload)
			}
			models := decodeOutput[struct {
				Models []Model `json:"models"`
			}](t, call(t, a, "list_models", map[string]any{}))
			if len(models.Models) != 3 {
				t.Fatalf("models=%+v", models.Models)
			}
			args := map[string]any{"modelId": "img", "clientRequestId": "same-job", "prompt": "A cat", "imageUrls": []string{"https://cdn.test/ref.png"}, "parameters": map[string]any{"resolution": "4k", "batchCount": 2}}
			first := decodeOutput[TaskOutput](t, call(t, a, "generate_image", args))
			again := decodeOutput[TaskOutput](t, call(t, a, "generate_image", args))
			if first.Task.ID != again.Task.ID || first.Task.Handler != "image_to_image" || first.StatusText != "processing" || first.PollAfterSeconds != 5 || !first.Task.IsAPICall {
				t.Fatalf("result=%+v", first)
			}
			other := decodeOutput[TaskOutput](t, call(t, b, "generate_image", args))
			if other.Task.ID == first.Task.ID {
				t.Fatal("users shared idempotency state")
			}
			if !call(t, b, "get_generation_task", map[string]any{"taskId": first.Task.ID}).IsError {
				t.Fatal("cross-user task access allowed")
			}
			f.mu.Lock()
			if f.charges != 2 {
				charges := f.charges
				f.mu.Unlock()
				t.Fatalf("charges=%d", charges)
			}
			task := f.jobs[first.Task.ID]
			task.Status = 1
			task.Progress = 100
			task.ResultURL = "https://cdn.test/result.png"
			task.ResultMeta = map[string]any{"urls": []string{task.ResultURL}}
			f.jobs[task.ID] = task
			f.mu.Unlock()
			completed := decodeOutput[TaskOutput](t, call(t, a, "get_generation_task", map[string]any{"taskId": first.Task.ID}))
			if completed.StatusText != "succeeded" || completed.Task.ResultURL == "" || completed.PollAfterSeconds != 0 {
				t.Fatalf("completed=%+v", completed)
			}
			if !call(t, a, "generate_audio", map[string]any{"modelId": "no-points", "clientRequestId": "no-points", "prompt": "music"}).IsError {
				t.Fatal("HTTP 200 business error was treated as success")
			}
			f.mu.Lock()
			f.disabled = true
			f.mu.Unlock()
			res, err := a.CallTool(context.Background(), &mcp.CallToolParams{Name: "get_balance", Arguments: map[string]any{}})
			if err == nil && !res.IsError {
				t.Fatal("disabled key accepted")
			}
		})
	}
}

func TestMediaModeMappingAndValidation(t *testing.T) {
	f, endpoint := setupServer(t)
	s := connect(t, endpoint, "key-a", "2026-07-28")
	cases := []struct {
		name    string
		args    map[string]any
		handler string
		ref     string
	}{
		{"generate_image", map[string]any{}, "text_to_image", ""},
		{"generate_video", map[string]any{}, "text_to_video", ""},
		{"generate_video", map[string]any{"imageUrls": []string{"https://cdn.test/start.png"}}, "image_to_video", "imageUrls"},
		{"generate_video", map[string]any{"firstFrame": "https://cdn.test/start.png", "lastFrame": "https://cdn.test/end.png"}, "start_end_to_video", "lastFrame"},
		{"generate_video", map[string]any{"videoUrls": []string{"https://cdn.test/ref.mp4"}, "audioUrls": []string{"https://cdn.test/music.mp3"}}, "reference_to_video", "videoReferences"},
		{"generate_audio", map[string]any{"parameters": map[string]any{"lyrics": "test lyrics", "extras": map[string]any{"make_instrumental": true}}}, "text_to_audio", "lyrics"},
	}
	for i, tc := range cases {
		tc.args["modelId"], tc.args["clientRequestId"], tc.args["prompt"] = "model", fmt.Sprint("job-", i), "prompt"
		out := decodeOutput[TaskOutput](t, call(t, s, tc.name, tc.args))
		if out.Task.Handler != tc.handler {
			t.Fatalf("handler=%s", out.Task.Handler)
		}
		if tc.ref != "" {
			input := out.Task.Input.(map[string]any)
			if input[tc.ref] == nil {
				t.Fatalf("reference %s not mapped", tc.ref)
			}
		}
	}
	f.mu.Lock()
	before := f.charges
	f.mu.Unlock()
	for _, args := range []map[string]any{
		{"modelId": "m", "clientRequestId": "bad", "parameters": map[string]any{"handler": "assistant_chat"}},
		{"modelId": "m", "clientRequestId": "bad", "mode": "assistant_chat"},
		{"modelId": "m", "clientRequestId": "bad", "firstFrame": "https://cdn.test/start.png"},
		{"modelId": "m", "clientRequestId": "bad", "imageUrls": []string{"C:/private.png"}},
	} {
		if !call(t, s, "generate_video", args).IsError {
			t.Fatalf("accepted invalid input: %+v", args)
		}
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.charges != before {
		t.Fatal("invalid requests reached paid API")
	}
}

func TestHTTPBoundaryAndOrigins(t *testing.T) {
	_, endpoint := setupServer(t)
	for _, tc := range []struct {
		key, origin string
		want        int
	}{{"", "", 401}, {"bad-key", "", 401}, {"key-a", "https://evil.test", 403}, {"key-a", "null", 403}} {
		req, _ := http.NewRequest("POST", endpoint+"/mcp", strings.NewReader(`{}`))
		req.Header.Set("Content-Type", "application/json")
		if tc.key != "" {
			req.Header.Set("Authorization", "Bearer "+tc.key)
		}
		if tc.origin != "" {
			req.Header.Set("Origin", tc.origin)
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != tc.want {
			t.Fatalf("status=%d want %d", res.StatusCode, tc.want)
		}
	}
	res, err := http.Get(endpoint + "/healthz")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 200 {
		t.Fatal("health unavailable")
	}
}

func TestNoCredentialRedirectOrErrorLeak(t *testing.T) {
	var forwarded bool
	target := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { forwarded = true }))
	defer target.Close()
	redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, target.URL, http.StatusFound) }))
	defer redirect.Close()
	c, _ := NewClient(redirect.URL)
	if _, err := c.Identity(WithCredentials(context.Background(), Credentials{APIKey: "private-key"})); err == nil {
		t.Fatal("redirect accepted")
	}
	if forwarded {
		t.Fatal("credential followed redirect")
	}
	failing := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(401)
		_ = json.NewEncoder(w).Encode(map[string]any{"message": "bad " + r.Header.Get("Authorization")})
	}))
	defer failing.Close()
	c, _ = NewClient(failing.URL)
	_, err := c.Identity(WithCredentials(context.Background(), Credentials{APIKey: "private-key"}))
	if err == nil || strings.Contains(err.Error(), "private-key") {
		t.Fatal("credential leaked in error")
	}
}

func TestLocalTransportUsesConfiguredKey(t *testing.T) {
	f := &fixture{jobs: map[string]Task{}, owners: map[string]string{}, requests: map[string]string{}}
	api := httptest.NewServer(f)
	defer api.Close()
	c, _ := NewClient(api.URL)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	clientTransport, serverTransport := mcp.NewInMemoryTransports()
	ss, err := NewServer(c).Connect(WithCredentials(ctx, Credentials{APIKey: "key-a"}), serverTransport, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer ss.Close()
	cs, err := mcp.NewClient(&mcp.Implementation{Name: "local", Version: "1"}, nil).Connect(ctx, clientTransport, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer cs.Close()
	identity := decodeOutput[Identity](t, call(t, cs, "get_balance", map[string]any{}))
	if identity.UserID != "key-a" {
		t.Fatal("local server did not propagate the configured API key")
	}
}

func TestAmbiguousCreateKeepsRequestIDForSafeRetry(t *testing.T) {
	f := &fixture{jobs: map[string]Task{}, owners: map[string]string{}, requests: map[string]string{}}
	var first atomic.Bool
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		recorded := httptest.NewRecorder()
		f.ServeHTTP(recorded, r)
		if first.CompareAndSwap(false, true) {
			<-r.Context().Done()
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(recorded.Body.Bytes())
	}))
	defer api.Close()
	c, _ := NewClient(api.URL)
	c.http.Timeout = 50 * time.Millisecond
	input := ImageInput{CommonInput: CommonInput{ModelID: "img", ClientRequestID: "timeout-job", Prompt: "cat"}}
	ctx := WithCredentials(context.Background(), Credentials{APIKey: "key-a"})
	if _, _, err := c.image(ctx, nil, input); err == nil {
		t.Fatal("expected lost acknowledgement")
	}
	c.http.Timeout = 3 * time.Second
	_, out, err := c.image(ctx, nil, input)
	if err != nil {
		t.Fatal(err)
	}
	f.mu.Lock()
	charges := f.charges
	f.mu.Unlock()
	if out.Task.ID == "" || charges != 1 {
		t.Fatalf("retry was not idempotent: charges=%d output=%+v", charges, out)
	}
}
