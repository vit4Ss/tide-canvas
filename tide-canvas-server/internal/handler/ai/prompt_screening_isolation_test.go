package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
	"tidecanvas/internal/app"
	"tidecanvas/internal/config"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
	"tidecanvas/internal/pkg/token"
	"tidecanvas/internal/pkg/userkey"
)

func TestPancakeFailureOnlyBlocksEnglishGenerationRoutes(t *testing.T) {
	db := concurrencyTestDB(t)
	pool, _ := db.DB()
	pool.SetMaxOpenConns(1)
	if err := db.AutoMigrate(&model.UserAPIKey{}, &model.MarketModel{}, &model.AiHandler{}, &model.AiProvider{}, &model.AiTool{}, &model.AiGenerationLog{}, &model.PointRecord{}, &model.PointRefundReceipt{}, &model.PromptSafetyCheck{}); err != nil {
		t.Fatal(err)
	}
	keys, err := userkey.New(db, "isolation-fixture-secret")
	if err != nil {
		t.Fatal(err)
	}
	apiKey := openTestKey(t, db, keys, 42, 100)
	token.Init(config.JWTConfig{Secret: "isolation-jwt-secret"}, nil)
	access, _, _, err := token.Issue(42, 0)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.MarketModel{Name: "Image", ModelKey: "isolated-image", Type: "image", Status: 1, Price: decimal.NewFromInt(7)}).Error; err != nil {
		t.Fatal(err)
	}
	var scans atomic.Int32
	adapter := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		scans.Add(1)
		w.WriteHeader(502)
		_, _ = w.Write([]byte(`{"error":"provider_unavailable","reasonCode":"upstream_unauthorized"}`))
	}))
	defer adapter.Close()
	provider := &openTestProvider{release: make(chan struct{})}
	svc := &service{repo: newRepo(db), registry: newHandlerRegistry(), provider: provider, sem: make(chan struct{}, 4),
		promptScreening: &promptScreeningClient{url: adapter.URL, token: "test", mode: "test", http: adapter.Client()}}
	d := &app.Deps{DB: db, UserKeys: keys, Cfg: &config.Config{Pancake: config.PancakeConfig{PromptScreening: true}}}
	h := &handler{svc: svc}
	engine := gin.New()
	h.registerRoutes(engine.Group("/api"), d)
	accepted := []idgen.ID{}
	t.Cleanup(func() {
		close(provider.release)
		deadline := time.Now().Add(3 * time.Second)
		for time.Now().Before(deadline) {
			active := false
			for _, id := range accepted {
				if _, ok := svc.taskCancels.Load(id); ok {
					active = true
				}
			}
			if !active {
				return
			}
			time.Sleep(5 * time.Millisecond)
		}
	})
	request := func(path, credential, body string) *httptest.ResponseRecorder {
		method := http.MethodPost
		if body == "" {
			method = http.MethodGet
		}
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if credential != "" {
			req.Header.Set("Authorization", "Bearer "+credential)
		}
		// Neither a claimed site header nor browser Origin can change the route policy.
		req.Header.Set("Origin", "https://flowlight.example")
		req.Header.Set("X-Billing-Market", "cn")
		res := httptest.NewRecorder()
		engine.ServeHTTP(res, req)
		return res
	}
	for path, expected := range map[string]bool{"/api/ai/safety-config": false, "/api/en/ai/safety-config": true} {
		var status response.Result[struct {
			PromptScreening bool `json:"promptScreening"`
		}]
		res := request(path, "", "")
		if err := json.Unmarshal(res.Body.Bytes(), &status); err != nil || !status.Success || status.Data.PromptScreening != expected {
			t.Fatalf("%s status=%s", path, res.Body.String())
		}
	}
	for _, tc := range []struct{ cn, en, key, id string }{
		{"/api/ai/generate", "/api/en/ai/generate", access, "studio-1"},
		{"/api/open/v1/generations", "/api/en/open/v1/generations", apiKey, "api-1"},
	} {
		body := `{"handler":"text_to_image","modelId":"isolated-image","clientRequestId":"` + tc.id + `","input":{"prompt":"landscape"}}`
		cn := request(tc.cn, tc.key, body)
		var created response.Result[AiTaskVO]
		if err := json.Unmarshal(cn.Body.Bytes(), &created); err != nil || !created.Success {
			t.Fatalf("CN generation blocked: %s", cn.Body.String())
		}
		accepted = append(accepted, created.Data.ID)
		before := scans.Load()
		// Reusing a CN task through EN must not masquerade as a screened submission.
		if replay := request(tc.en, tc.key, body); replay.Code != 400 {
			t.Fatalf("cross-site task replay accepted: %s", replay.Body.String())
		}
		body = strings.Replace(body, tc.id, "en-"+tc.id, 1)
		if tc.cn == "/api/ai/generate" {
			body = strings.TrimSuffix(body, "}") + `,"billingMarket":"cn","screening":false}`
		}
		en := request(tc.en, tc.key, body)
		if en.Code != 400 || !strings.Contains(en.Body.String(), "No generation credits were charged") || scans.Load() != before+1 {
			t.Fatalf("EN did not enforce screening: %s", en.Body.String())
		}
	}
	if scans.Load() != 2 {
		t.Fatalf("CN contacted Pancake: calls=%d", scans.Load())
	}
	var owner model.User
	db.First(&owner, 42)
	var tasks, charges, checks int64
	db.Model(&model.AiTask{}).Count(&tasks)
	db.Model(&model.PointRecord{}).Count(&charges)
	db.Model(&model.PromptSafetyCheck{}).Count(&checks)
	if owner.Points != 86 || tasks != 2 || charges != 2 || checks != 2 {
		t.Fatalf("CN/EN accounting isolation failed: points=%d tasks=%d charges=%d checks=%d", owner.Points, tasks, charges, checks)
	}
	for _, path := range []string{"/api/en/ai/generate", "/api/en/open/v1/generations"} {
		if res := request(path, "", `{}`); res.Code != 401 {
			t.Fatalf("EN route lost authentication: %s", res.Body.String())
		}
	}
}

func TestLegacyFacadesSkipPancakeAndClientCannotForgeMarket(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); w.WriteHeader(401) }))
	defer server.Close()
	s := &service{promptScreening: &promptScreeningClient{url: server.URL, http: server.Client()}}
	dto := generateDTO{}
	if err := json.Unmarshal([]byte(`{"billingMarket":"en","BillingMarket":"en","input":{"prompt":"hello"}}`), &dto); err != nil {
		t.Fatal(err)
	}
	if dto.BillingMarket != "" {
		t.Fatal("client can assign market")
	}
	m := &model.AiModel{Type: "image"}
	if err := s.prepareScreenedGenerationPrompt(context.Background(), 42, &dto, m, genHandler{name: "text_to_image"}, nil); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 0 || len(dto.screenedInput) > 0 {
		t.Fatal("existing facade acquired a Pancake dependency")
	}
	legacyHash, _ := directGenerationFingerprint(dto)
	dto.BillingMarket = model.BillingMarketEN
	enHash, _ := directGenerationFingerprint(dto)
	if legacyHash == enHash {
		t.Fatal("idempotency omitted site policy")
	}
}
