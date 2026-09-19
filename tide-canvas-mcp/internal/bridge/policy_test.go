package bridge

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type policyFixture struct {
	mu        sync.Mutex
	policy    Policy
	status    int
	malformed bool
}

func (p *policyFixture) serve(w http.ResponseWriter, r *http.Request) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if r.Header.Get("Authorization") != "" {
		panic("policy fetch included a user credential")
	}
	if p.status != 0 {
		w.WriteHeader(p.status)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	if p.malformed {
		_, _ = w.Write([]byte(`{"success":true,"data":null}`))
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "data": p.policy})
}
func expirePolicy(c *Client) { c.policyMu.Lock(); c.policyExpires = time.Time{}; c.policyMu.Unlock() }

func TestManagedPolicyAppliesToHTTPAndLocalTransports(t *testing.T) {
	f := &fixture{jobs: map[string]Task{}, owners: map[string]string{}, requests: map[string]string{}}
	p := &policyFixture{policy: Policy{Enabled: true, ImageEnabled: true, VideoEnabled: false, AudioEnabled: true, SchemaVersion: 1, Revision: 1, Configured: true, PollIntervalSeconds: 12, AllowedOrigins: []string{"https://managed.test"}}}
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/mcp/config" {
			p.serve(w, r)
			return
		}
		f.ServeHTTP(w, r)
	}))
	defer api.Close()
	c, _ := NewClient(api.URL)
	handler, _ := NewHTTPHandler(c, []string{"https://env.test"})
	srv := httptest.NewServer(handler)
	defer srv.Close()
	s := connect(t, srv.URL, "key-a", "2026-07-28")
	list, err := s.ListTools(context.Background(), &mcp.ListToolsParams{})
	if err != nil {
		t.Fatal(err)
	}
	for _, tool := range list.Tools {
		if tool.Name == "generate_video" {
			t.Fatal("disabled video tool is still listed")
		}
	}
	if len(list.Tools) != 6 {
		t.Fatalf("tool count=%d", len(list.Tools))
	}
	args := map[string]any{"modelId": "m", "prompt": "test", "clientRequestId": "policy-job"}
	if !call(t, s, "generate_video", args).IsError {
		t.Fatal("hidden video tool could still be invoked")
	}
	image := decodeOutput[TaskOutput](t, call(t, s, "generate_image", args))
	if image.PollAfterSeconds != 12 {
		t.Fatalf("poll interval=%d", image.PollAfterSeconds)
	}
	for _, origin := range []string{"https://managed.test", "https://env.test"} {
		r := httptest.NewRequest("POST", "http://localhost/mcp", strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}`))
		r.Header.Set("Origin", origin)
		r.Header.Set("Authorization", "Bearer key-a")
		r.Header.Set("Accept", "application/json, text/event-stream")
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		want := 200
		if origin == "https://env.test" {
			want = 403
		}
		if w.Code != want {
			t.Fatalf("origin %s status=%d body=%s", origin, w.Code, w.Body.String())
		}
	}
	p.mu.Lock()
	p.policy.Enabled = false
	p.policy.Revision = 2
	p.mu.Unlock()
	expirePolicy(c)
	result, err := s.CallTool(context.Background(), &mcp.CallToolParams{Name: "generate_image", Arguments: args})
	if err == nil && !result.IsError {
		t.Fatal("HTTP master switch ignored")
	}
	clientTransport, serverTransport := mcp.NewInMemoryTransports()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	ss, err := NewServer(c).Connect(WithCredentials(ctx, Credentials{APIKey: "key-a"}), serverTransport, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer ss.Close()
	cs, err := mcp.NewClient(&mcp.Implementation{Name: "local-policy", Version: "1"}, nil).Connect(ctx, clientTransport, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer cs.Close()
	if !call(t, cs, "generate_image", args).IsError {
		t.Fatal("stdio bypassed disabled MCP policy")
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.charges != 1 {
		t.Fatalf("disabled tools charged %d times", f.charges)
	}
}

func TestPolicyFailuresAndRollbackNeverReenableManagedTools(t *testing.T) {
	p := &policyFixture{policy: Policy{Enabled: false, ImageEnabled: true, VideoEnabled: true, AudioEnabled: true, SchemaVersion: 1, Revision: 3, Configured: true, PollIntervalSeconds: 5}}
	api := httptest.NewServer(http.HandlerFunc(p.serve))
	defer api.Close()
	c, _ := NewClient(api.URL)
	policy, err := c.Policy(context.Background())
	if err != nil || policy.Enabled {
		t.Fatalf("policy=%+v %v", policy, err)
	}
	for _, status := range []int{404, 500} {
		p.mu.Lock()
		p.status = status
		p.mu.Unlock()
		expirePolicy(c)
		if _, err := c.Policy(context.Background()); err == nil {
			t.Fatalf("HTTP %d reopened policy", status)
		}
	}
	p.mu.Lock()
	p.status = 0
	p.malformed = true
	p.mu.Unlock()
	expirePolicy(c)
	if _, err := c.Policy(context.Background()); err == nil {
		t.Fatal("malformed policy accepted")
	}
	p.mu.Lock()
	p.malformed = false
	p.policy.Revision = 2
	p.policy.Enabled = true
	p.mu.Unlock()
	expirePolicy(c)
	if _, err := c.Policy(context.Background()); err == nil {
		t.Fatal("older server configuration overrode the disabled policy")
	}
	p.mu.Lock()
	p.policy.Revision = 4
	p.mu.Unlock()
	expirePolicy(c)
	if policy, err := c.Policy(context.Background()); err != nil || !policy.Enabled {
		t.Fatal("valid new policy did not recover")
	}
}

func TestPolicyWaitersCanCancelWithoutBlockingOrCancellingOtherUsers(t *testing.T) {
	started, release := make(chan struct{}), make(chan struct{})
	var reads atomic.Int32
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if reads.Add(1) == 1 {
			close(started)
		}
		select {
		case <-release:
		case <-r.Context().Done():
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"success": true, "data": Policy{Enabled: true, ImageEnabled: true, VideoEnabled: true, AudioEnabled: true, SchemaVersion: 1, Revision: 1, Configured: true, PollIntervalSeconds: 5}})
	}))
	defer api.Close()
	c, _ := NewClient(api.URL)
	firstCtx, cancelFirst := context.WithCancel(context.Background())
	defer cancelFirst()
	first := make(chan error, 1)
	go func() { _, err := c.Policy(firstCtx); first <- err }()
	<-started
	secondCtx, cancelSecond := context.WithCancel(context.Background())
	second := make(chan error, 1)
	go func() { _, err := c.Policy(secondCtx); second <- err }()
	cancelSecond()
	select {
	case err := <-second:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("cancelled waiter=%v", err)
		}
	case <-time.After(time.Second):
		close(release)
		t.Fatal("cancelled waiter blocked behind network mutex")
	}
	cancelFirst()
	select {
	case err := <-first:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("first caller=%v", err)
		}
	case <-time.After(time.Second):
		close(release)
		t.Fatal("first caller did not cancel")
	}
	close(release)
	policy, err := c.Policy(context.Background())
	if err != nil || !policy.Enabled {
		t.Fatalf("other callers lost shared configuration: %v", err)
	}
	if reads.Load() != 1 {
		t.Fatalf("concurrent reads were not coalesced: %d", reads.Load())
	}
}

func TestPolicyReadFailuresAreThrottledAndNeverReturnStaleAllowance(t *testing.T) {
	var reads atomic.Int32
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { reads.Add(1); w.WriteHeader(500) }))
	defer api.Close()
	c, _ := NewClient(api.URL)
	c.policy = Policy{Enabled: true, ImageEnabled: true, SchemaVersion: 1, Revision: 2, Configured: true, PollIntervalSeconds: 5}
	for i := 0; i < 5; i++ {
		if policy, err := c.Policy(context.Background()); err == nil || policy.Enabled {
			t.Fatal("failed refresh returned stale enabled policy")
		}
	}
	if reads.Load() != 1 {
		t.Fatalf("an outage caused %d duplicate reads", reads.Load())
	}
	if c.policy.Revision != 2 {
		t.Fatal("last valid version watermark was lost")
	}
}

func TestFreshServerDoesNotEnableMCPWhenPolicyEndpointIsMissing(t *testing.T) {
	var protectedCalls atomic.Int32
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/mcp/config" {
			protectedCalls.Add(1)
		}
		w.WriteHeader(404)
	}))
	defer api.Close()
	for restart := 0; restart < 2; restart++ {
		c, _ := NewClient(api.URL)
		if policy, err := c.Policy(context.Background()); err == nil || policy.Enabled {
			t.Fatal("fresh process defaulted to enabled without managed policy")
		}
		h, _ := NewHTTPHandler(c, nil)
		r := httptest.NewRequest("POST", "http://localhost/mcp", strings.NewReader(`{}`))
		r.Header.Set("Authorization", "Bearer key-a")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 503 {
			t.Fatalf("unmanaged call status=%d", w.Code)
		}
	}
	if protectedCalls.Load() != 0 {
		t.Fatal("missing policy reached protected API")
	}
}
