package ai

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
	"tidecanvas/internal/app"
	"tidecanvas/internal/middleware"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
	"tidecanvas/internal/pkg/userkey"
)

func TestOpenGenerationRejectsForgedMetadataAndAmbiguousBodies(t *testing.T) {
	valid := `{"handler":"text_to_image","modelId":"image-test","clientRequestId":"request-1","input":{"prompt":"hello"}}`
	for _, body := range []string{
		`null`, `[]`, valid + ` {}`, strings.Replace(valid, `"input":{"prompt":"hello"}`, `"input":null`, 1),
		strings.Replace(valid, `"input":{"prompt":"hello"}`, `"input":[]`, 1),
		strings.Replace(valid, `"request-1"`, `""`, 1),
	} {
		if _, err := decodeOpenGeneration(strings.NewReader(body), ""); err == nil {
			t.Fatalf("accepted invalid body: %s", body)
		}
	}
	for _, field := range []string{"userId", "projectId", "isApiCall", "pointCost", "origin", "skillRunId", "registerWork"} {
		body := strings.TrimSuffix(valid, "}") + `,"` + field + `":0}`
		if _, err := decodeOpenGeneration(strings.NewReader(body), ""); err == nil {
			t.Fatalf("accepted client field %s", field)
		}
	}
	if _, err := decodeOpenGeneration(strings.NewReader(valid), "different"); err == nil {
		t.Fatal("accepted conflicting idempotency keys")
	}
	dto, err := decodeOpenGeneration(strings.NewReader(valid), "request-1")
	if err != nil || !dto.IsAPICall || dto.ProjectID != 0 || dto.EntryPoint != "api" || dto.ClientRequestID != "open-api:request-1" {
		t.Fatalf("DTO=%+v err=%v", dto, err)
	}
	var ui generateDTO
	if err := json.Unmarshal([]byte(`{"isApiCall":true,"origin":"api"}`), &ui); err != nil || ui.IsAPICall || ui.Origin != "" {
		t.Fatal("UI caller can forge API provenance")
	}
	a, _ := directGenerationFingerprint(dto)
	dto.IsAPICall = false
	b, _ := directGenerationFingerprint(dto)
	if a == b {
		t.Fatal("idempotency does not distinguish trusted API provenance")
	}
}

type openTestProvider struct {
	calls      atomic.Int32
	restricted atomic.Bool
	release    chan struct{}
}

func TestOpenGenerationAliasesMatchBillingAndProvider(t *testing.T) {
	var firstHash string
	for _, raw := range []string{
		`{"n":2,"resolution":"4K"}`,
		`{"batchCount":2,"clarity":"4k"}`,
		`{"batch":2,"resolution":"4k","clarity":"4K"}`,
		`{"n":2,"batchCount":2.0,"clarity":"4k"}`,
	} {
		dto, err := decodeOpenGeneration(strings.NewReader(`{"handler":"text_to_image","modelId":"m","input":`+raw+`}`), "aliases-1")
		if err != nil {
			t.Fatal(err)
		}
		input := decodeInput(dto.Input)
		if n := batchCount(input); n != 2 {
			t.Fatalf("provider image count=%d for %s", n, raw)
		}
		m := &model.AiModel{Type: "image", PointCost: 1, Config: `{"pricing":{"default":{"1k":3,"4k":20}}}`}
		if cost := resolveCost(m, dto.Input); cost != 40 {
			t.Fatalf("charged %d points for two 4k images", cost)
		}
		p := &relayProviderClient{}
		if p.imageParams("m", input).Resolution != "4k" {
			t.Fatal("provider used a different resolution from pricing")
		}
		hash, err := directGenerationFingerprint(dto)
		if err != nil {
			t.Fatal(err)
		}
		if firstHash == "" {
			firstHash = hash
		} else if hash != firstHash {
			t.Fatal("equivalent aliases broke idempotent replay")
		}
		m.Config = `{"hideBatchCount":true}`
		if err := validateHiddenBatchCountInput(&dto, m); err == nil {
			t.Fatal("API alias bypassed single-image policy")
		}
	}
	for _, raw := range []string{
		`{"n":0}`, `{"n":null}`, `{"n":"2"}`, `{"n":1.5}`, `{"n":5}`, `{"batchCount":2,"n":1}`,
		`{"batchCount":2,"batch":3}`, `{"resolution":"4k","clarity":"1k"}`, `{"resolution":null}`, `{"clarity":4}`,
	} {
		if _, err := decodeOpenGeneration(strings.NewReader(`{"handler":"text_to_image","modelId":"m","input":`+raw+`}`), "bad-1"); err == nil {
			t.Fatalf("accepted invalid/conflicting input %s", raw)
		}
	}
	for _, handler := range []string{"text_to_audio", "generate_3d", "assistant_chat", "text_to_video", "video_upscale"} {
		if _, err := decodeOpenGeneration(strings.NewReader(`{"handler":"`+handler+`","modelId":"m","input":{"n":2}}`), "bad-2"); err == nil {
			t.Fatalf("unsupported batch accepted for %s", handler)
		}
	}
}

func (p *openTestProvider) Type() string { return "open-api-test" }
func (p *openTestProvider) Generate(ctx context.Context, _ GenerateRequest) (GenerateResult, error) {
	p.restricted.Store(middleware.IsUserAPIKeyRequest(ctx))
	p.calls.Add(1)
	select {
	case <-p.release:
	case <-ctx.Done():
	}
	return GenerateResult{}, errors.New("test upstream failure")
}

func openTestKey(t *testing.T, db *gorm.DB, keys *userkey.Service, uid idgen.ID, balance int64) string {
	t.Helper()
	if err := db.Create(&model.User{ID: uid, Username: uid.String(), Email: uid.String() + "@api.test", Status: 1, Points: balance}).Error; err != nil {
		t.Fatal(err)
	}
	row, err := keys.Ensure(context.Background(), uid)
	if err != nil {
		t.Fatal(err)
	}
	key, err := keys.Reveal(context.Background(), uid, row.Revision)
	if err != nil {
		t.Fatal(err)
	}
	return key
}

func TestOpenAPIAuthenticationBillingRetryAndOwnerHistory(t *testing.T) {
	db := concurrencyTestDB(t)
	pool, _ := db.DB()
	pool.SetMaxOpenConns(1)
	if err := db.AutoMigrate(&model.UserAPIKey{}, &model.MarketModel{}, &model.AiHandler{}, &model.AiProvider{}, &model.AiGenerationLog{}, &model.PointRecord{}, &model.PointRefundReceipt{}); err != nil {
		t.Fatal(err)
	}
	keys, err := userkey.New(db, "open-api-test-secret")
	if err != nil {
		t.Fatal(err)
	}
	key := openTestKey(t, db, keys, 42, 7)
	otherKey := openTestKey(t, db, keys, 43, 0)
	m := model.MarketModel{Name: "Test Image", ModelKey: "image-test", Type: "image", Status: 1, Price: decimal.NewFromInt(7)}
	if err := db.Create(&m).Error; err != nil {
		t.Fatal(err)
	}
	provider := &openTestProvider{release: make(chan struct{})}
	svc := &service{repo: newRepo(db), registry: newHandlerRegistry(), provider: provider, sem: make(chan struct{}, 1)}
	h := &handler{svc: svc}
	engine := gin.New()
	h.registerOpenAPI(engine.Group("/api"), &app.Deps{DB: db, UserKeys: keys})
	request := func(method, path, credential, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, "/api/open/v1"+path, strings.NewReader(body))
		if credential != "" {
			req.Header.Set("Authorization", "Bearer "+credential)
		}
		req.Header.Set("Content-Type", "application/json")
		res := httptest.NewRecorder()
		engine.ServeHTTP(res, req)
		return res
	}
	for _, invalid := range []string{"", "invalid", "a.jwt.token"} {
		if res := request("GET", "/models", invalid, ""); res.Code != 401 {
			t.Fatalf("invalid auth %d", res.Code)
		}
	}
	if res := request("GET", "/models", key, ""); res.Code != 200 || !strings.Contains(res.Body.String(), "image-test") {
		t.Fatalf("catalog=%s", res.Body.String())
	}
	body := `{"handler":"text_to_image","modelId":"image-test","clientRequestId":"job-1","input":{"prompt":"hello","n":1}}`
	// Force both submissions past the initial missing-task lookup before either
	// debits the wallet. The second transaction then sees a zero balance.
	bothMissed := make(chan struct{})
	var misses atomic.Int32
	if err := db.Callback().Query().After("gorm:query").Register("open_api_simultaneous_miss", func(tx *gorm.DB) {
		if errors.Is(tx.Error, gorm.ErrRecordNotFound) && strings.Contains(tx.Statement.SQL.String(), "client_request_id") {
			if misses.Add(1) == 2 {
				close(bothMissed)
			}
			select {
			case <-bothMissed:
			case <-time.After(3 * time.Second):
				tx.AddError(errors.New("idempotency test barrier timed out"))
			}
		}
	}); err != nil {
		t.Fatal(err)
	}
	responses := make(chan *httptest.ResponseRecorder, 2)
	for i := 0; i < 2; i++ {
		go func() { responses <- request("POST", "/generations", key, body) }()
	}
	res := <-responses
	second := <-responses
	if err := db.Callback().Query().Remove("open_api_simultaneous_miss"); err != nil {
		t.Fatal(err)
	}
	var first response.Result[AiTaskVO]
	if err := json.Unmarshal(res.Body.Bytes(), &first); err != nil || !first.Success || !first.Data.IsAPICall || first.Data.PointCost != 7 {
		t.Fatalf("create=%s err=%v", res.Body.String(), err)
	}
	released := false
	t.Cleanup(func() {
		if !released {
			close(provider.release)
		}
		deadline := time.Now().Add(3 * time.Second)
		for time.Now().Before(deadline) {
			if _, active := svc.taskCancels.Load(first.Data.ID); !active {
				return
			}
			time.Sleep(5 * time.Millisecond)
		}
	})
	var simultaneous response.Result[AiTaskVO]
	if err := json.Unmarshal(second.Body.Bytes(), &simultaneous); err != nil || !simultaneous.Success || simultaneous.Data.ID != first.Data.ID {
		t.Fatalf("simultaneous retry=%s", second.Body.String())
	}
	for i := 0; i < 3; i++ {
		var retry response.Result[AiTaskVO]
		res = request("POST", "/generations", key, body)
		if err := json.Unmarshal(res.Body.Bytes(), &retry); err != nil || !retry.Success || retry.Data.ID != first.Data.ID {
			t.Fatalf("replay=%s", res.Body.String())
		}
	}
	if res := request("POST", "/generations", key, strings.Replace(body, "hello", "changed", 1)); res.Code != 400 {
		t.Fatalf("conflict=%s", res.Body.String())
	}
	res = request("POST", "/generations", otherKey, body)
	var rejected response.Result[any]
	if err := json.Unmarshal(res.Body.Bytes(), &rejected); err != nil || rejected.Success || rejected.Code != response.CodeQuotaInsufficient {
		t.Fatalf("balance gate=%s", res.Body.String())
	}
	var owner model.User
	if err := db.First(&owner, "id = ?", 42).Error; err != nil || owner.Points != 0 {
		t.Fatalf("balance=%d err=%v", owner.Points, err)
	}
	var count int64
	if err := db.Model(&model.PointRecord{}).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("deductions=%d %v", count, err)
	}
	if res := request("GET", "/tasks/"+first.Data.ID.String(), otherKey, ""); res.Code != 403 {
		t.Fatalf("foreign task accessible: %s", res.Body.String())
	}
	legacy := model.AiTask{ID: idgen.Next(), UserID: 42, Status: statusSuccess}
	if err := db.Create(&legacy).Error; err != nil {
		t.Fatal(err)
	}
	var list response.Result[response.PageData[AiTaskVO]]
	res = request("GET", "/tasks?userId=43&isApiCall=false", key, "")
	if err := json.Unmarshal(res.Body.Bytes(), &list); err != nil || !list.Success || list.Data.Total != 1 || !list.Data.Records[0].IsAPICall {
		t.Fatalf("API history=%s", res.Body.String())
	}
	rows, total, err := svc.listTasks(context.Background(), 42, taskQuery{NoProject: true}, 0, 20)
	if err != nil || total != 2 || len(rows) != 2 {
		t.Fatalf("shared history=%v %d %v", rows, total, err)
	}
	if toTaskVO(&legacy).IsAPICall {
		t.Fatal("legacy task labeled as API")
	}
	row, _ := keys.Ensure(context.Background(), 42)
	if _, err := keys.Change(context.Background(), 42, row.Revision, true, true); err != nil {
		t.Fatal(err)
	}
	if res := request("GET", "/tasks", key, ""); res.Code != 401 {
		t.Fatal("rotated key accepted")
	}
	// The accepted task continues independently of credential rotation. A
	// provider failure must refund the original debit exactly once.
	close(provider.release)
	released = true
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if _, active := svc.taskCancels.Load(first.Data.ID); !active {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if _, active := svc.taskCancels.Load(first.Data.ID); active {
		t.Fatal("task did not finish")
	}
	if provider.calls.Load() != 1 {
		t.Fatalf("provider calls=%d", provider.calls.Load())
	}
	if !provider.restricted.Load() {
		t.Fatal("detached API task lost its restricted credential scope")
	}
	if err := db.First(&owner, "id = ?", 42).Error; err != nil || owner.Points != 7 {
		t.Fatalf("refund balance=%d %v", owner.Points, err)
	}
	task, err := svc.repo.getTask(context.Background(), first.Data.ID)
	if err != nil || task.Status != statusFailed || !task.Refunded || !task.IsAPICall {
		t.Fatalf("failed task=%+v %v", task, err)
	}
	if err := refundTaskOnce(db, task.ID, "duplicate recovery"); err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.PointRecord{}).Count(&count).Error; err != nil || count != 2 {
		t.Fatalf("ledger rows after refund=%d %v", count, err)
	}
	states, err := svc.repo.taskLogStates(context.Background(), []idgen.ID{task.ID})
	if err != nil || !states[task.ID].IsAPICall {
		t.Fatalf("history provenance lost: %v", err)
	}
}

// Text is metered per token through the chat gateway when it is called with an
// API key. The generation API therefore shows the gateway's text models (with
// the endpoint they are called at) instead of the site's per-call ones, lists
// no text handler, and refuses a text generation: a caller who tries is told
// where to go, and nothing is charged.
func TestOpenAPIListsGatewayTextModelsAndRefusesTextGenerations(t *testing.T) {
	db := concurrencyTestDB(t)
	pool, _ := db.DB()
	pool.SetMaxOpenConns(1)
	if err := db.AutoMigrate(&model.UserAPIKey{}, &model.MarketModel{}, &model.AiHandler{}, &model.AiProvider{}, &model.AiGenerationLog{}, &model.PointRecord{}, &model.PointRefundReceipt{}, &model.ChatProvider{}, &model.ChatEndpoint{}, &model.ChatModel{}); err != nil {
		t.Fatal(err)
	}
	chatProvider := model.ChatProvider{Name: "Chat Provider", Enabled: true}
	if err := db.Create(&chatProvider).Error; err != nil {
		t.Fatal(err)
	}
	for _, m := range []model.ChatModel{
		{ProviderID: chatProvider.ID, ModelKey: "chat-test", Name: "Chat Test", Enabled: true, Pricing: `{"tokenPricing":{"enabled":true,"inputPointsPerMillion":"100","outputPointsPerMillion":"300","maxInputTokens":1000,"maxOutputTokens":1000}}`},
		{ProviderID: chatProvider.ID, ModelKey: "chat-unpriced", Name: "Unpriced", Enabled: true},
	} {
		if err := db.Create(&m).Error; err != nil {
			t.Fatal(err)
		}
	}
	keys, err := userkey.New(db, "open-api-test-secret")
	if err != nil {
		t.Fatal(err)
	}
	key := openTestKey(t, db, keys, 44, 10)
	for _, m := range []model.MarketModel{
		{Name: "Test Image", ModelKey: "image-test", Type: "image", Status: 1, Price: decimal.NewFromInt(1)},
		{Name: "Test Text", ModelKey: "text-test", Type: "text", Status: 1, Price: decimal.NewFromInt(1)},
	} {
		if err := db.Create(&m).Error; err != nil {
			t.Fatal(err)
		}
	}
	for _, name := range []string{"text_to_image", assistantChatHandler} {
		if err := db.Create(&model.AiHandler{ID: idgen.Next(), HandlerName: name, Name: name, Enabled: true}).Error; err != nil {
			t.Fatal(err)
		}
	}
	svc := &service{repo: newRepo(db), registry: newHandlerRegistry(), provider: &openTestProvider{release: make(chan struct{})}, sem: make(chan struct{}, 1)}
	h := &handler{svc: svc}
	engine := gin.New()
	h.registerOpenAPI(engine.Group("/api"), &app.Deps{DB: db, UserKeys: keys})
	request := func(method, path, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, "/api/open/v1"+path, strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+key)
		req.Header.Set("Content-Type", "application/json")
		res := httptest.NewRecorder()
		engine.ServeHTTP(res, req)
		return res
	}
	models := request("GET", "/models", "")
	if models.Code != 200 || !strings.Contains(models.Body.String(), "image-test") || strings.Contains(models.Body.String(), "text-test") {
		t.Fatalf("the generation catalogue still offers the site's per-call text model: %s", models.Body.String())
	}
	var catalogue struct {
		Data []AiModelVO `json:"data"`
	}
	if err := json.Unmarshal(models.Body.Bytes(), &catalogue); err != nil {
		t.Fatal(err)
	}
	var chat *AiModelVO
	for i := range catalogue.Data {
		if catalogue.Data[i].ModelID == "flowinglight/chat-test" {
			chat = &catalogue.Data[i]
		}
		if catalogue.Data[i].ModelID == "flowinglight/chat-unpriced" {
			t.Fatal("a gateway model without a price was listed; the gateway would refuse it")
		}
	}
	if chat == nil {
		t.Fatalf("the gateway text model is missing from the API catalogue: %s", models.Body.String())
	}
	if chat.Type != "text" || chat.Endpoint != "/api/integrations/v1/responses" || chat.Billing != "token" || !strings.Contains(chat.Config, `"inputPointsPerMillion":"100"`) {
		t.Fatalf("gateway text model is not described as such: %+v", chat)
	}
	handlers := request("GET", "/handlers", "")
	if handlers.Code != 200 || !strings.Contains(handlers.Body.String(), "text_to_image") || strings.Contains(handlers.Body.String(), assistantChatHandler) {
		t.Fatalf("the handler list still offers text: %s", handlers.Body.String())
	}
	res := request("POST", "/generations", `{"handler":"assistant_chat","modelId":"text-test","clientRequestId":"text-1","input":{"prompt":"hello"}}`)
	var out struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if out.Code != response.CodeHandlerNotFound || !strings.Contains(out.Message, "/api/integrations/v1") {
		t.Fatalf("text generation was not redirected to the gateway: %s", res.Body.String())
	}
	var records int64
	db.Model(&model.PointRecord{}).Count(&records)
	if records != 0 {
		t.Fatalf("a refused text call moved points: %d records", records)
	}
}
