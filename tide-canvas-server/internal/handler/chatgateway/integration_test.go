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

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	gormlog "gorm.io/gorm/logger"
	"tidecanvas/internal/app"
	"tidecanvas/internal/config"
	"tidecanvas/internal/middleware"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/token"
	"tidecanvas/internal/pkg/userkey"
)

type fixture struct {
	s      *service
	router *gin.Engine
	user   model.User
	apiKey string
	jwt    string
}

// setup builds the smallest gateway a test can call: one user with a key and
// 20 points, one provider with one address at relayURL, one priced model.
// Tests that need more add to it.
func setup(t *testing.T, relayURL string) *fixture {
	t.Helper()
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open("file:"+idgen.Next().String()+"?mode=memory&cache=shared"), &gorm.Config{Logger: gormlog.Default.LogMode(gormlog.Silent), SkipDefaultTransaction: true})
	if err != nil {
		t.Fatal(err)
	}
	pool, _ := db.DB()
	pool.SetMaxOpenConns(1)
	t.Cleanup(func() { pool.Close() })
	if err := db.AutoMigrate(&model.User{}, &model.UserAPIKey{}, &model.ModelGatewayRequest{}, &model.ChatProvider{}, &model.ChatEndpoint{}, &model.ChatModel{}, &model.PointRecord{}, &model.PointRefundReceipt{}, &model.AiTask{}); err != nil {
		t.Fatal(err)
	}
	user := model.User{ID: idgen.Next(), Username: "alice", Email: "alice@example.test", Status: 1, Points: 20}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	provider := model.ChatProvider{Name: "Test Provider", Enabled: true}
	if err := db.Create(&provider).Error; err != nil {
		t.Fatal(err)
	}
	keys, _ := userkey.New(db, "test-key-vault-secret")
	keyRow, err := keys.Ensure(context.Background(), user.ID)
	if err != nil {
		t.Fatal(err)
	}
	apiKey, err := keys.Reveal(context.Background(), user.ID, keyRow.Revision)
	if err != nil {
		t.Fatal(err)
	}
	cfg := &config.Config{ChatGateway: config.ChatGatewayConfig{MaxConcurrent: 2}, Relay: config.RelayConfig{BaseURL: relayURL, APIKey: "upstream-secret-only"}}
	d := &app.Deps{DB: db, Cfg: cfg, UserKeys: keys}
	s, err := newService(d)
	if err != nil {
		t.Fatal(err)
	}
	// The endpoint's credential is sealed with the service's own vault, and its
	// address is the test upstream (loopback http, which only the admin form
	// refuses - the gateway calls whatever is stored).
	sealed, err := s.upstreams.Seal("upstream-secret-only")
	if err != nil {
		t.Fatal(err)
	}
	if relayURL == "" {
		// A closed loopback port, for tests that never reach the upstream: a
		// call to it fails to connect, which is what an absent provider does.
		relayURL = "http://127.0.0.1:1"
	}
	if err := db.Create(&model.ChatEndpoint{ProviderID: provider.ID, Label: "primary", BaseURL: relayURL, APIKey: sealed, Enabled: true}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.ChatModel{ProviderID: provider.ID, ModelKey: "test-model", Name: "Test Model", Enabled: true, Pricing: tokenTestPricing}).Error; err != nil {
		t.Fatal(err)
	}
	token.Init(config.JWTConfig{Secret: "jwt-unit-test-secret"}, nil)
	access, _, _, err := token.Issue(user.ID, 0)
	if err != nil {
		t.Fatal(err)
	}
	r := gin.New()
	r.Use(middleware.RequestID())
	RegisterService(r.Group("/api"), s)
	return &fixture{s: s, router: r, user: user, apiKey: apiKey, jwt: access}
}
func (f *fixture) request(method, path, body, bearer string, headers map[string]string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	f.router.ServeHTTP(w, req)
	return w
}
func jsonMap(t *testing.T, w *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatalf("invalid JSON %q: %v", w.Body.String(), err)
	}
	return out
}

func TestGatewayChargesOnceAndKeepsPartialOutputBilling(t *testing.T) {
	for _, ending := range []string{"stop", "eof", "length", "error"} {
		t.Run(ending, func(t *testing.T) {
			var calls atomic.Int32
			var received map[string]any
			up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				if r.Header.Get("Authorization") != "Bearer upstream-secret-only" {
					t.Error("wrong upstream credential")
				}
				_ = json.NewDecoder(r.Body).Decode(&received)
				w.Header().Set("Content-Type", "text/event-stream")
				fmt.Fprint(w, "data: {\"id\":\"result\",\"choices\":[{\"delta\":{\"content\":\"hello\"}}]}\n\n")
				switch ending {
				case "stop", "length":
					fmt.Fprintf(w, "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"%s\"}]}\n\ndata: {\"choices\":[],\"usage\":{\"prompt_tokens\":100,\"completion_tokens\":100,\"total_tokens\":200}}\n\ndata: [DONE]\n\n", ending)
				case "error":
					fmt.Fprint(w, "data: {\"error\":{\"message\":\"upstream-secret-only\"}}\n\n")
				}
			}))
			defer up.Close()
			f := setup(t, up.URL)
			messages := []any{map[string]any{"role": "system", "content": "rules"}}
			for i := 0; i < 7; i++ {
				role := "user"
				if i%2 == 1 {
					role = "assistant"
				}
				messages = append(messages, map[string]any{"role": role, "content": fmt.Sprint(i)})
			}
			body, _ := json.Marshal(map[string]any{"model": "test-model", "messages": messages, "stream": true, "user": "forged-owner"})
			headers := map[string]string{"Idempotency-Key": "same-request"}
			w := f.request("POST", "/api/integrations/v1/chat/completions", string(body), f.apiKey, headers)
			var user model.User
			f.s.d.DB.First(&user, "id = ?", f.user.ID)
			// An ending that reports usage is charged for it and releases the
			// rest of the hold: 100 input + 100 output has a 0.04 raw cost and
			// is charged as one whole point. "eof" and
			// "error" report none, so the hold stays for manual review instead
			// of the cost being guessed.
			if ending == "stop" || ending == "length" {
				if user.PointBalance() != 19 || user.PointHeldMicros != 0 {
					t.Fatalf("%s: balance=%v held=%d body=%s", ending, user.PointBalance(), user.PointHeldMicros, w.Body.String())
				}
			} else if user.PointHeldMicros != 1_000_000 || user.Points != 20 {
				t.Fatalf("%s: usage was absent, so nothing may be charged: balance=%v held=%d", ending, user.PointBalance(), user.PointHeldMicros)
			}
			expect := map[string]string{"stop": "hello", "length": "incomplete_response",
				"eof": "token_usage_unavailable", "error": "token_usage_unavailable"}[ending]
			if !strings.Contains(w.Body.String(), expect) {
				t.Fatalf("%s: expected %q in %s", ending, expect, w.Body.String())
			}
			if strings.Contains(w.Body.String(), "upstream-secret-only") {
				t.Fatal("upstream secret leaked")
			}
			// The history goes up untrimmed — the window is the client's setting,
			// not this gateway's — while the forged owner is still replaced.
			gotMessages := received["messages"].([]any)
			if len(gotMessages) != 8 || received["user"] != f.user.ID.String() {
				t.Fatalf("bad model input: %#v", received)
			}
			if gotMessages[1].(map[string]any)["content"] != "0" {
				t.Fatal("the history was trimmed")
			}
			_ = f.request("POST", "/api/integrations/v1/chat/completions", string(body), f.apiKey, headers)
			if calls.Load() != 1 {
				t.Fatal("idempotent retry repeated the provider call")
			}
			f.s.d.DB.First(&user, "id = ?", f.user.ID)
			if ending == "stop" && (user.PointBalance() != 19 || user.PointHeldMicros != 0) {
				t.Fatalf("retry charged again: balance=%v held=%d", user.PointBalance(), user.PointHeldMicros)
			}
		})
	}
}

func TestGatewayRefundsNoOutputAndCountsAccountQuota(t *testing.T) {
	var fail atomic.Bool
	fail.Store(true)
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		if fail.Load() {
			fmt.Fprint(w, "data: {\"error\":{\"message\":\"unavailable\"}}\n\n")
			return
		}
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"ok\"},\"finish_reason\":\"stop\"}]}\n\ndata: {\"choices\":[],\"usage\":{\"prompt_tokens\":100,\"completion_tokens\":100,\"total_tokens\":200}}\n\ndata: [DONE]\n\n")
	}))
	defer up.Close()
	f := setup(t, up.URL)
	f.s.d.DB.Model(&model.User{}).Where("id = ?", f.user.ID).Update("api_quota", 1)
	body := `{"model":"test-model","messages":[{"role":"user","content":"hello"}]}`
	w := f.request("POST", "/api/integrations/v1/chat/completions", body, f.apiKey, map[string]string{"Idempotency-Key": "failed"})
	if w.Code != 502 {
		t.Fatal(w.Body.String())
	}
	var user model.User
	f.s.d.DB.First(&user, "id = ?", f.user.ID)
	if user.Points != 20 {
		t.Fatal("empty failure was charged")
	}
	fail.Store(false)
	w = f.request("POST", "/api/integrations/v1/chat/completions", body, f.apiKey, map[string]string{"Idempotency-Key": "success"})
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	w = f.request("POST", "/api/integrations/v1/chat/completions", body, f.apiKey, map[string]string{"Idempotency-Key": "quota-exceeded"})
	if w.Code != 429 || !strings.Contains(w.Body.String(), "account_quota") {
		t.Fatal("account quota was not enforced")
	}
}

func TestGatewayRejectsInsufficientBalanceBeforeUpstream(t *testing.T) {
	var calls atomic.Int32
	up := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1) }))
	defer up.Close()
	f := setup(t, up.URL)
	f.s.d.DB.Model(&model.User{}).Where("id = ?", f.user.ID).Update("points", 0)
	w := f.request("POST", "/api/integrations/v1/chat/completions", `{"model":"test-model","messages":[{"role":"user","content":"hello"}]}`, f.apiKey, nil)
	if w.Code != http.StatusTooManyRequests || calls.Load() != 0 || !strings.Contains(w.Body.String(), `"code":"insufficient_quota"`) || !strings.Contains(w.Body.String(), "可用积分不足") {
		t.Fatal("insufficient balance reached provider")
	}
	var count int64
	f.s.d.DB.Model(&model.ModelGatewayRequest{}).Count(&count)
	if count != 0 {
		t.Fatal("failed charge retained a pending reservation")
	}
}
