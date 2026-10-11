package ai

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"

	"tidecanvas/internal/app"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"tidecanvas/internal/pkg/response"
	"tidecanvas/internal/pkg/userkey"
)

// Exercise the real authenticated HTTP → quote → wallet → asynchronous failure
// path with a held provider. No paid upstream or network media probe is used.
func TestUpscaleAPIBillingReplayAndRefundMatchQuotedCost(t *testing.T) {
	db := concurrencyTestDB(t)
	pool, _ := db.DB()
	pool.SetMaxOpenConns(1)
	if err := db.AutoMigrate(&model.UserAPIKey{}, &model.MarketModel{}, &model.AiHandler{}, &model.AiProvider{}, &model.AiGenerationLog{}, &model.PointRecord{}, &model.PointRefundReceipt{}); err != nil {
		t.Fatal(err)
	}
	keys, err := userkey.New(db, "upscale-billing-test-secret")
	if err != nil {
		t.Fatal(err)
	}
	key := openTestKey(t, db, keys, 42, 11)
	poorKey := openTestKey(t, db, keys, 43, 10)
	cfg, price, _, err := model.RepricedUpscaleConfig("rh-upscale", "upscale", `{}`)
	if err != nil {
		t.Fatal(err)
	}
	row := model.MarketModel{Name: "RH", ModelKey: "rh-upscale", Type: "upscale", Status: 1, Config: cfg, Price: price}
	if err := db.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	provider := &openTestProvider{release: make(chan struct{})}
	svc := &service{repo: newRepo(db), registry: newHandlerRegistry(), provider: provider, sem: make(chan struct{}, 1), confirmVideoDuration: func(context.Context, idgen.ID, string) (string, float64, error) {
		return "https://cdn.example/video.mp4", 5.132, nil
	}}
	engine := gin.New()
	(&handler{svc: svc}).registerOpenAPI(engine.Group("/api"), &app.Deps{DB: db, UserKeys: keys})
	request := func(path, credential, body string) *httptest.ResponseRecorder {
		req := httptest.NewRequest("POST", "/api/open/v1"+path, strings.NewReader(body))
		req.Header.Set("Authorization", "Bearer "+credential)
		req.Header.Set("Content-Type", "application/json")
		res := httptest.NewRecorder()
		engine.ServeHTTP(res, req)
		return res
	}
	var quote response.Result[upscaleQuoteVO]
	res := request("/upscale-quote", key, `{"modelId":"rh-upscale","videoUrl":"https://cdn.example/video.mp4","targetResolution":"1080p","upscaleModel":"max"}`)
	if err := json.Unmarshal(res.Body.Bytes(), &quote); err != nil || !quote.Success || quote.Data.PointCost != 11 {
		t.Fatalf("quote: %s (%v)", res.Body.String(), err)
	}
	var count int64
	db.Model(&model.PointRecord{}).Count(&count)
	if count != 0 {
		t.Fatal("quoting charged points")
	}
	body := `{"handler":"video_upscale","modelId":"rh-upscale","clientRequestId":"upscale-job-1","input":{"videoUrl":"https://cdn.example/video.mp4","targetResolution":"1080p","upscaleModel":"max","duration":0.01,"billedSeconds":0.01,"pointCost":0}}`
	var rejected response.Result[any]
	res = request("/generations", poorKey, body)
	if err := json.Unmarshal(res.Body.Bytes(), &rejected); err != nil || rejected.Success || rejected.Code != response.CodeQuotaInsufficient {
		t.Fatalf("insufficient balance gate: %s", res.Body.String())
	}
	var taskID idgen.ID
	var once sync.Once
	finish := func() { once.Do(func() { close(provider.release) }) }
	waitDone := func() {
		deadline := time.Now().Add(3 * time.Second)
		for time.Now().Before(deadline) {
			if _, active := svc.taskCancels.Load(taskID); !active {
				return
			}
			time.Sleep(5 * time.Millisecond)
		}
		t.Error("upscale worker did not finish")
	}
	t.Cleanup(func() { finish(); waitDone() })
	var first response.Result[AiTaskVO]
	res = request("/generations", key, body)
	if err := json.Unmarshal(res.Body.Bytes(), &first); err != nil || !first.Success || first.Data.PointCost != int64(quote.Data.PointCost) {
		t.Fatalf("submit vs quote: %s", res.Body.String())
	}
	taskID = first.Data.ID
	// Subsequent price edits cannot alter an accepted task or its eventual refund.
	if err := db.Model(&row).Update("config", `{"pricePerSecondByUpscaleModel":{"max":99,"high":99,"medium":99,"low":99}}`).Error; err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		var retry response.Result[AiTaskVO]
		res = request("/generations", key, body)
		if err := json.Unmarshal(res.Body.Bytes(), &retry); err != nil || !retry.Success || retry.Data.ID != taskID || retry.Data.PointCost != 11 {
			t.Fatalf("retry changed debit: %s", res.Body.String())
		}
	}
	var owner, poor model.User
	db.First(&owner, 42)
	db.First(&poor, 43)
	db.Model(&model.PointRecord{}).Count(&count)
	if count != 1 || owner.Points != 0 || poor.Points != 10 {
		t.Fatalf("wallet mismatch: records=%d owner=%d poor=%d", count, owner.Points, poor.Points)
	}
	finish()
	waitDone()
	task, err := svc.repo.getTask(context.Background(), taskID)
	if err != nil || task.Status != statusFailed || !task.Refunded || task.PointCost != 11 {
		t.Fatalf("failed task state: %+v %v", task, err)
	}
	if err := refundTaskOnce(db, taskID, "repeated recovery"); err != nil {
		t.Fatal(err)
	}
	db.First(&owner, 42)
	db.Model(&model.PointRecord{}).Count(&count)
	if owner.Points != 11 || count != 2 || provider.calls.Load() != 1 {
		t.Fatalf("refund/replay mismatch: balance=%d ledger=%d calls=%d", owner.Points, count, provider.calls.Load())
	}
}
