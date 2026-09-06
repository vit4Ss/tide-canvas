package lobehub

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
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

func setup(t *testing.T, lobeURL, relayURL string) *fixture {
	t.Helper()
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open("file:"+idgen.Next().String()+"?mode=memory&cache=shared"), &gorm.Config{Logger: gormlog.Default.LogMode(gormlog.Silent), SkipDefaultTransaction: true})
	if err != nil {
		t.Fatal(err)
	}
	pool, _ := db.DB()
	pool.SetMaxOpenConns(1)
	t.Cleanup(func() { pool.Close() })
	if err := db.AutoMigrate(&model.User{}, &model.UserAPIKey{}, &model.LobeHubGrant{}, &model.LobeHubLink{}, &model.ModelGatewayRequest{}, &model.ChatProvider{}, &model.ChatEndpoint{}, &model.ChatModel{}, &model.PointRecord{}, &model.PointRefundReceipt{}, &model.AiTask{}); err != nil {
		t.Fatal(err)
	}
	user := model.User{ID: idgen.Next(), Username: "alice", Email: "alice@example.test", Status: 1, Points: 20}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	// One provider, one address, one priced model — the smallest supply chain
	// AI chat will serve. Tests that need more add to it.
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
	signer, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	der, _ := x509.MarshalPKCS8PrivateKey(signer)
	keyPath := filepath.Join(t.TempDir(), "signing.pem")
	if err := os.WriteFile(keyPath, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der}), 0600); err != nil {
		t.Fatal(err)
	}
	if lobeURL == "" {
		lobeURL = "http://127.0.0.1:3210"
	}
	cfg := &config.Config{LobeHub: config.LobeHubConfig{Enabled: true, PublicURL: lobeURL, InternalURL: lobeURL, IssuerURL: "http://127.0.0.1:8081/api/lobehub/oidc", ClientID: "test-client", ClientSecret: strings.Repeat("s", 32), SigningKeyFile: keyPath, MaxConcurrent: 2}, Relay: config.RelayConfig{BaseURL: relayURL, APIKey: "upstream-secret-only"}}
	d := &app.Deps{DB: db, Cfg: cfg, UserKeys: keys}
	s, err := newService(d)
	if err != nil {
		t.Fatal(err)
	}
	// The endpoint's credential is sealed with the service's own vault, and its
	// address is the test upstream (loopback http, which only the admin form
	// refuses — the gateway calls whatever is stored).
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

func TestOIDCAuthorizationPKCEAndReplay(t *testing.T) {
	f := setup(t, "", "")
	verifier := strings.Repeat("x", 43)
	sum := sha256.Sum256([]byte(verifier))
	q := url.Values{"client_id": {f.s.cfg.ClientID}, "redirect_uri": {f.s.cfg.PublicURL + "/api/auth/oauth2/callback/generic-oidc"}, "response_type": {"code"}, "scope": {"openid profile email"}, "code_challenge_method": {"S256"}, "code_challenge": {base64.RawURLEncoding.EncodeToString(sum[:])}, "state": {"roundtrip-state"}, "nonce": {"test-nonce"}}
	w := f.request("GET", "/api/lobehub/oidc/authorize?"+q.Encode(), "", "", nil)
	if w.Code != 302 {
		t.Fatal(w.Body.String())
	}
	location, _ := url.Parse(w.Header().Get("Location"))
	requestID := location.Query().Get("request")
	w = f.request("POST", "/api/lobehub/oidc/approve", `{"request":"`+requestID+`"}`, f.jwt, nil)
	data := jsonMap(t, w)["data"].(map[string]any)
	location, _ = url.Parse(data["url"].(string))
	code := location.Query().Get("code")
	if location.Query().Get("state") != "roundtrip-state" {
		t.Fatal("OAuth state was changed")
	}
	form := url.Values{"grant_type": {"authorization_code"}, "code": {code}, "redirect_uri": {q.Get("redirect_uri")}, "client_id": {f.s.cfg.ClientID}, "client_secret": {f.s.cfg.ClientSecret}, "code_verifier": {strings.Repeat("y", 43)}}
	w = f.request("POST", "/api/lobehub/oidc/token", form.Encode(), "", map[string]string{"Content-Type": "application/x-www-form-urlencoded"})
	if w.Code != 400 {
		t.Fatal("wrong PKCE verifier accepted")
	}
	form.Set("code_verifier", verifier)
	w = f.request("POST", "/api/lobehub/oidc/token", form.Encode(), "", map[string]string{"Content-Type": "application/x-www-form-urlencoded"})
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	result := jsonMap(t, w)
	parsed, err := jwt.Parse(result["id_token"].(string), func(*jwt.Token) (any, error) { return &f.s.signer.PublicKey, nil }, jwt.WithIssuer(f.s.cfg.IssuerURL), jwt.WithAudience(f.s.cfg.ClientID), jwt.WithValidMethods([]string{"RS256"}))
	if err != nil {
		t.Fatal(err)
	}
	claims := parsed.Claims.(jwt.MapClaims)
	if claims["nonce"] != "test-nonce" || claims["sub"] != f.user.ID.String() {
		t.Fatal("wrong ID token identity")
	}
	w = f.request("GET", "/api/lobehub/oidc/userinfo", "", result["access_token"].(string), nil)
	if w.Code != 200 || jsonMap(t, w)["sub"] != f.user.ID.String() {
		t.Fatal("userinfo failed")
	}
	w = f.request("GET", "/api/lobehub/oidc/userinfo", "", result["id_token"].(string), nil)
	if w.Code != 401 {
		t.Fatal("ID token accepted as access token")
	}
	w = f.request("POST", "/api/lobehub/oidc/token", form.Encode(), "", map[string]string{"Content-Type": "application/x-www-form-urlencoded"})
	if w.Code != 400 {
		t.Fatal("authorization code replay accepted")
	}
	q.Set("redirect_uri", "https://attacker.example/callback")
	w = f.request("GET", "/api/lobehub/oidc/authorize?"+q.Encode(), "", "", nil)
	if w.Code != 400 || w.Header().Get("Location") != "" {
		t.Fatal("unregistered callback accepted")
	}
	f.s.d.DB.Model(&model.User{}).Where("id = ?", f.user.ID).Update("status", 0)
	w = f.request("GET", "/api/lobehub/oidc/userinfo", "", result["access_token"].(string), nil)
	if w.Code != 401 {
		t.Fatal("disabled user accepted")
	}
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
			f := setup(t, "", up.URL)
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
			// rest of the hold: 100 input + 100 output = 0.04 积分. "eof" and
			// "error" report none, so the hold stays for manual review instead
			// of the cost being guessed.
			if ending == "stop" || ending == "length" {
				if user.PointBalance() != 19.96 || user.PointHeldMicros != 0 {
					t.Fatalf("%s: balance=%v held=%d body=%s", ending, user.PointBalance(), user.PointHeldMicros, w.Body.String())
				}
			} else if user.PointHeldMicros != 400_000 || user.Points != 20 {
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
			// The history goes up untrimmed — the window is LobeHub's setting,
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
			if ending == "stop" && (user.PointBalance() != 19.96 || user.PointHeldMicros != 0) {
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
	f := setup(t, "", up.URL)
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
	f := setup(t, "", up.URL)
	f.s.d.DB.Model(&model.User{}).Where("id = ?", f.user.ID).Update("points", 0)
	w := f.request("POST", "/api/integrations/v1/chat/completions", `{"model":"test-model","messages":[{"role":"user","content":"hello"}]}`, f.apiKey, nil)
	if w.Code != 402 || calls.Load() != 0 {
		t.Fatal("insufficient balance reached provider")
	}
	var count int64
	f.s.d.DB.Model(&model.ModelGatewayRequest{}).Count(&count)
	if count != 0 {
		t.Fatal("failed charge retained a pending reservation")
	}
}

func TestBindVerifiesActualLobeIdentityAndKeepsKeyServerSide(t *testing.T) {
	var mainID string
	var rpcCalls []string
	var rpcBodies []string
	var keyTransferred string
	lobe := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Header.Get("Cookie") != "session=valid" {
			w.WriteHeader(401)
			fmt.Fprint(w, `{}`)
			return
		}
		switch r.URL.Path {
		case "/api/auth/get-session":
			fmt.Fprint(w, `{"user":{"id":"lobe-user"}}`)
		case "/api/auth/list-accounts":
			fmt.Fprintf(w, `[{"providerId":"generic-oidc","accountId":"%s"}]`, mainID)
		case "/trpc/lambda/agent.getBuiltinAgent":
			fmt.Fprint(w, `{"result":{"data":{"json":{"id":"inbox-agent"}}}}`)
		default:
			rpcCalls = append(rpcCalls, r.URL.Path)
			raw, _ := io.ReadAll(r.Body)
			rpcBodies = append(rpcBodies, r.URL.Path+" "+string(raw))
			if strings.Contains(r.URL.Path, "updateAiProviderConfig") {
				var input map[string]any
				_ = json.Unmarshal(raw, &input)
				keyTransferred = input["json"].(map[string]any)["value"].(map[string]any)["keyVaults"].(map[string]any)["apiKey"].(string)
			}
			fmt.Fprint(w, `{"result":{"data":{"json":null}}}`)
		}
	}))
	defer lobe.Close()
	f := setup(t, lobe.URL, "")
	mainID = f.user.ID.String()
	launch := jsonMap(t, f.request("POST", "/api/lobehub/launch", fmt.Sprintf(`{"accountId":"%s"}`, f.user.ID), f.jwt, nil))["data"].(map[string]any)["url"].(string)
	u, _ := url.Parse(launch)
	ticket := u.Query().Get("ticket")
	headers := map[string]string{"Origin": lobe.URL, "Cookie": "session=valid"}
	mainID = "other-user"
	w := f.request("POST", "/api/lobehub/bind", `{"ticket":"`+ticket+`"}`, "", headers)
	if w.Code != 409 || len(rpcCalls) != 0 {
		t.Fatal("identity mismatch transferred credentials")
	}
	mainID = f.user.ID.String()
	w = f.request("POST", "/api/lobehub/bind", `{"ticket":"`+ticket+`"}`, "", headers)
	if w.Code != 200 || keyTransferred != f.apiKey {
		t.Fatalf("binding failed: code=%d, calls=%v body=%s", w.Code, rpcCalls, w.Body.String())
	}
	// A binding configures the provider and its models, hides the other
	// providers, then sets this user's defaults.
	for _, procedure := range []string{
		"/trpc/lambda/aiProvider.updateAiProviderConfig",
		"/trpc/lambda/aiProvider.updateAiProvider",
		"/trpc/lambda/aiProvider.toggleProviderEnabled",
		"/trpc/lambda/aiModel.clearRemoteModels",
		"/trpc/lambda/aiModel.batchUpdateAiModels",
		"/trpc/lambda/aiModel.batchToggleAiModels",
		"/trpc/lambda/aiProvider.getAiProviderList",
		"/trpc/lambda/user.updateSettings",
		"/trpc/lambda/agent.updateAgentConfig",
	} {
		if !slices.Contains(rpcCalls, procedure) {
			t.Fatalf("binding skipped %s: %v", procedure, rpcCalls)
		}
	}
	// Every model this sync names — the catalogue, the connectivity check, the
	// default agent, the system agents — must use the id LobeHub will know it
	// under. A bare key anywhere points LobeHub at a model that is not in its
	// list, and for an OpenAI-looking key it also puts the call back on the
	// /v1/responses path this gateway does not serve.
	for _, body := range rpcBodies {
		// Remove the namespaced form first: whatever mention of the key is left
		// is a bare one, even when the same payload got the other mentions right.
		if strings.Contains(strings.ReplaceAll(body, "flowinglight/test-model", ""), "test-model") {
			t.Fatalf("a sync payload named the model by its bare key: %s", body)
		}
	}

	// Clearing has to come before the push, or the sync deletes what it just
	// wrote and the user is left with an empty model picker.
	clear := slices.Index(rpcCalls, "/trpc/lambda/aiModel.clearRemoteModels")
	push := slices.Index(rpcCalls, "/trpc/lambda/aiModel.batchUpdateAiModels")
	if clear > push {
		t.Fatalf("the sync cleared the models it had just pushed: %v", rpcCalls)
	}
	if strings.Contains(w.Body.String(), f.apiKey) {
		t.Fatal("key returned to bridge browser")
	}
	var link model.LobeHubLink
	if err := f.s.d.DB.First(&link, "user_id = ?", f.user.ID).Error; err != nil || link.LobeUserID != "lobe-user" {
		t.Fatal("mapping not saved")
	}
}
