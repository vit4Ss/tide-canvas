package admin

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"net/http/httptest"
	"strings"
	"testing"
	"tidecanvas/internal/handler/ai"
	"tidecanvas/internal/handler/points"
	"tidecanvas/internal/middleware"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"time"
)

func TestTemplateSavePreservesAConcurrentGeneratedCover(t *testing.T) {
	s, _ := coverFixture(t)
	var original model.StudioTemplate
	if err := s.db.First(&original, 1).Error; err != nil {
		t.Fatal(err)
	}
	h := &studioTemplatesHandler{db: s.db}
	r := gin.New()
	r.PUT("/:id", h.save)
	call := func(cover, expected, description string) (bool, int, model.StudioTemplate) {
		t.Helper()
		raw, _ := json.Marshal(original)
		var payload map[string]any
		_ = json.Unmarshal(raw, &payload)
		payload["coverUrl"] = cover
		payload["expectedCoverUrl"] = expected
		payload["description"] = description
		raw, _ = json.Marshal(payload)
		req := httptest.NewRequest("PUT", "/1", strings.NewReader(string(raw)))
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		var result struct {
			Success bool
			Code    int
			Data    model.StudioTemplate
		}
		if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		return result.Success, result.Code, result.Data
	}
	generated := "https://fixture.test/generated-after-open.png"
	if err := s.db.Model(&original).Update("cover_url", generated).Error; err != nil {
		t.Fatal(err)
	}
	ok, _, saved := call("", "", "Updated operator description")
	if !ok || saved.CoverURL != generated || saved.Description != "Updated operator description" {
		t.Fatal("stale editor erased the generated cover", saved)
	}
	ok, _, _ = call(generated, "", "Updated operator description")
	if !ok {
		t.Fatal("retry of an already saved cover was reported as a conflict")
	}
	ok, code, _ := call("https://fixture.test/manual.png", "", "Should not save")
	if ok || code != 409 {
		t.Fatal("concurrent explicit cover changes were silently overwritten", code)
	}
	var current model.StudioTemplate
	s.db.First(&current, 1)
	if current.CoverURL != generated || current.Description != "Updated operator description" {
		t.Fatal("conflict changed stored content")
	}
	// An intentional clear based on the current cover is still permitted.
	ok, _, _ = call("", generated, "Intentional clear")
	if !ok {
		t.Fatal("explicit clear was blocked")
	}
	// Also catch a cover arriving between the initial read and the SQL update.
	armed := true
	if err := s.db.Callback().Update().Before("gorm:update").Register("test:cover-arrives", func(tx *gorm.DB) {
		if armed && tx.Statement.Table == "studio_template" {
			armed = false
			tx.AddError(tx.Exec("UPDATE studio_template SET cover_url = ? WHERE id = ?", generated, 1).Error)
		}
	}); err != nil {
		t.Fatal(err)
	}
	ok, code, _ = call("", "", "Should not race")
	if ok || code != 409 {
		t.Fatal("cover update race was not rejected", code)
	}
	s.db.Callback().Update().Remove("test:cover-arrives")
	s.db.First(&current, 1)
	if current.CoverURL != generated || current.Description != "Intentional clear" {
		t.Fatal("race overwrote cover or operator text")
	}
	// MySQL can report zero affected rows for an unchanged save.
	if err := s.db.Callback().Update().After("gorm:update").Register("test:no-op", func(tx *gorm.DB) {
		if tx.Statement.Table == "studio_template" {
			tx.RowsAffected = 0
		}
	}); err != nil {
		t.Fatal(err)
	}
	ok, _, _ = call(generated, generated, "Intentional clear")
	if !ok {
		t.Fatal("unchanged save was reported as a conflict")
	}
	s.db.Callback().Update().Remove("test:no-op")
	h.urlRewrites = [][2]string{{"https://bucket.example.test", "https://cdn.example.test"}}
	originalURL := "https://bucket.example.test/old.png"
	if err := s.db.Model(&model.StudioTemplate{}).Where("id = ?", 1).Update("cover_url", originalURL).Error; err != nil {
		t.Fatal(err)
	}
	ok, _, saved = call("https://cdn.example.test/old.png", "https://cdn.example.test/old.png", "CDN display")
	if !ok || saved.CoverURL != originalURL {
		t.Fatal("display URL rewrite changed an untouched stored cover")
	}
	ok, _, saved = call("https://cdn.example.test/new.png", "https://cdn.example.test/old.png", "Replace cover")
	if !ok || saved.CoverURL != "https://cdn.example.test/new.png" {
		t.Fatal("CDN rewrite caused a false edit conflict")
	}
}

type fakeCoverGenerator struct {
	db           *gorm.DB
	calls        int
	lose         bool
	onRecover    func()
	recoverErr   error
	recoverFound bool
}

func (f *fakeCoverGenerator) Recover(ctx context.Context, uid idgen.ID, cmd ai.GenerationCommand) (idgen.ID, bool, error) {
	if f.onRecover != nil {
		hook := f.onRecover
		f.onRecover = nil
		hook()
	}
	if f.recoverErr != nil {
		return 0, f.recoverFound, f.recoverErr
	}
	var task model.AiTask
	err := f.db.WithContext(ctx).Where("user_id = ? AND client_request_id = ?", uid, cmd.ClientRequestID).First(&task).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return 0, false, nil
	}
	return task.ID, err == nil, err
}

func TestCoverBatchLostWorkerCannotStopReplacement(t *testing.T) {
	for _, change := range []string{"replaced", "expired"} {
		t.Run(change, func(t *testing.T) {
			s, f := coverFixture(t)
			ctx := context.Background()
			filter := coverBatchFilter{Category: "food"}
			p, err := s.preview(ctx, 42, filter)
			if err != nil {
				t.Fatal(err)
			}
			b, err := s.create(ctx, 42, filter, p.QuoteToken, "lost-worker")
			if err != nil {
				t.Fatal(err)
			}
			f.onRecover = func() {
				field, value := "worker", any("replacement-worker")
				if change == "expired" {
					field, value = "lease_until", time.Now().Add(-time.Second)
				}
				if err := s.db.Model(b).Update(field, value).Error; err != nil {
					t.Fatal(err)
				}
				f.recoverErr, f.recoverFound = errors.New("mismatched recovered request"), true
			}
			if err := s.tick(ctx); !errors.Is(err, errCoverBatchLeaseLost) {
				t.Fatal("stale worker did not yield execution", err)
			}
			saved := readCoverBatch(t, s, b.ID)
			if saved.StopRequested || saved.Error != "" || saved.Items[0].Status != "pending" {
				t.Fatal("stale worker modified replacement's batch", saved.StopRequested, saved.Error, saved.Items[0].Status)
			}
			if f.calls != 0 {
				t.Fatal("stale worker submitted a task")
			}
		})
	}
}

func TestCoverBatchStopCheckpointsBeforeLaterRecoveryFailure(t *testing.T) {
	s, f := coverFixture(t)
	ctx := context.Background()
	filter := coverBatchFilter{Category: "food"}
	p, err := s.preview(ctx, 42, filter)
	if err != nil {
		t.Fatal(err)
	}
	b, err := s.create(ctx, 42, filter, p.QuoteToken, "stop-checkpoint")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.db.Model(b).Update("stop_requested", true).Error; err != nil {
		t.Fatal(err)
	}
	f.onRecover = func() {
		f.onRecover = func() { f.recoverErr = context.DeadlineExceeded }
	}
	if err := s.tick(ctx); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatal("expected interrupted recovery", err)
	}
	saved := readCoverBatch(t, s, b.ID)
	if saved.Items[0].Status != "skipped" || saved.Items[1].Status != "pending" {
		t.Fatal("stopping lost its checkpoint", saved.Items[0].Status, saved.Items[1].Status)
	}
	f.recoverErr = nil
	tickCover(t, s)
	saved = readCoverBatch(t, s, b.ID)
	if saved.Status != "stopped" || saved.ActiveKey != nil || f.calls != 0 {
		t.Fatal("interrupted stop did not resume safely")
	}
}

func TestCoverBatchStopDuringPreparationDoesNotLaunchNextImage(t *testing.T) {
	s, f := coverFixture(t)
	ctx := context.Background()
	filter := coverBatchFilter{Category: "food"}
	p, err := s.preview(ctx, 42, filter)
	if err != nil {
		t.Fatal(err)
	}
	b, err := s.create(ctx, 42, filter, p.QuoteToken, "stop-in-flight")
	if err != nil {
		t.Fatal(err)
	}
	f.onRecover = func() {
		if err := s.db.Model(b).Update("stop_requested", true).Error; err != nil {
			t.Fatal(err)
		}
	}
	tickCover(t, s)
	if f.calls != 0 {
		t.Fatal("stop was acknowledged but a new paid image was submitted")
	}
	tickCover(t, s)
	batch := readCoverBatch(t, s, b.ID)
	if batch.Status != "stopped" {
		t.Fatal("batch did not stop")
	}
	var owner model.User
	s.db.First(&owner, 42)
	if owner.Points != 100 {
		t.Fatal("stopped preparation charged points")
	}
}

func TestCoverBatchStopIsIdempotentForOwnedActiveAndCompletedJobs(t *testing.T) {
	s, _ := coverFixture(t)
	ctx := context.Background()
	p, err := s.preview(ctx, 42, coverBatchFilter{Category: "food"})
	if err != nil {
		t.Fatal(err)
	}
	b, err := s.create(ctx, 42, coverBatchFilter{Category: "food"}, p.QuoteToken, "stop-retry")
	if err != nil {
		t.Fatal(err)
	}
	updates := 0
	if err := s.db.Callback().Update().After("gorm:update").Register("test:stop-writes", func(tx *gorm.DB) {
		if tx.Statement.Table == "template_cover_batches" {
			updates++
		}
	}); err != nil {
		t.Fatal(err)
	}
	r := gin.New()
	r.Use(func(c *gin.Context) { c.Set(middleware.CtxUserID, idgen.ID(42)) })
	r.POST("/:batchId", s.stopHTTP)
	call := func() {
		t.Helper()
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest("POST", "/"+b.ID.String(), nil))
		if !strings.Contains(w.Body.String(), `"success":true`) {
			t.Fatal(w.Body.String())
		}
	}
	call()
	call()
	if updates != 1 {
		t.Fatal("duplicate stop unnecessarily wrote again", updates)
	}
	if err := s.db.Model(b).Updates(map[string]any{"active_key": nil, "status": "stopped"}).Error; err != nil {
		t.Fatal(err)
	}
	updates = 0
	call()
	if updates != 0 {
		t.Fatal("completed stop should be a no-op")
	}
}

func (f *fakeCoverGenerator) Submit(ctx context.Context, uid idgen.ID, cmd ai.GenerationCommand) (idgen.ID, error) {
	var old model.AiTask
	if f.db.Where("user_id = ? AND client_request_id = ?", uid, cmd.ClientRequestID).First(&old).Error == nil {
		return old.ID, nil
	}
	if strings.Contains(cmd.Input["prompt"].(string), "PRIVATE_RECIPE") {
		return 0, errors.New("private recipe leaked")
	}
	f.calls++
	request := cmd.ClientRequestID
	task := model.AiTask{ID: idgen.Next(), UserID: uid, ClientRequestID: &request, Status: ai.TaskProcessing, PointCost: 7, CreateTime: time.Now(), UpdateTime: time.Now()}
	err := f.db.Transaction(func(tx *gorm.DB) error {
		if e := points.Consume(tx, uid, 7, "cover test", task.ID); e != nil {
			return e
		}
		return tx.Create(&task).Error
	})
	if err != nil {
		return 0, err
	}
	if f.lose {
		f.lose = false
		return 0, errors.New("lost submission response")
	}
	return task.ID, nil
}
func (f *fakeCoverGenerator) Get(_ context.Context, uid, tid idgen.ID) (*ai.TaskSnapshot, error) {
	var task model.AiTask
	if err := f.db.First(&task, "id = ? AND user_id = ?", tid, uid).Error; err != nil {
		return nil, err
	}
	return &ai.TaskSnapshot{ID: task.ID, UserID: uid, Status: task.Status, ResultURL: task.ResultUrl, PointCost: task.PointCost}, nil
}
func coverFixture(t *testing.T) (*coverBatchService, *fakeCoverGenerator) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	pool, _ := db.DB()
	pool.SetMaxOpenConns(1)
	t.Cleanup(func() { pool.Close() })
	if err := db.AutoMigrate(&model.User{}, &model.MarketModel{}, &model.StudioTemplate{}, &model.TemplateCoverBatch{}, &model.AiTask{}, &model.PointRecord{}); err != nil {
		t.Fatal(err)
	}
	for _, row := range []any{
		&model.User{ID: 42, Username: "cover-admin", Email: "cover@test", Status: 1, Points: 100},
		&model.User{ID: 43, Username: "other-admin", Email: "other@test", Status: 1, Points: 100},
		&model.MarketModel{Name: "Ordinary primary", ModelKey: "ordinary", Type: "image", Status: 1, SortOrder: 0, Price: decimal.NewFromInt(99), Config: `{"imagePrimary":true,"modes":["t2i"]}`},
		&model.MarketModel{Name: "Cover enabled", ModelKey: "cover", Type: "image", Status: 1, SortOrder: 1, Price: decimal.NewFromInt(7), Config: `{"templateCoverBatch":true,"modes":["t2i"],"ratios":["16:9"]}`},
		&model.MarketModel{Name: "Later enabled", ModelKey: "later", Type: "image", Status: 1, SortOrder: 2, Price: decimal.NewFromInt(9), Config: `{"templateCoverBatch":true,"modes":["t2i"]}`},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	for i := 1; i <= 4; i++ {
		row := model.StudioTemplate{BaseModel: model.BaseModel{ID: idgen.ID(i)}, Kind: "inspiration", MediaType: "video", Title: fmt.Sprintf("Template %d", i), Description: "description", Category: "food", Prompt: "PRIVATE_RECIPE", Mode: "ref", Status: 0}
		if i == 3 {
			row.CoverURL = "https://fixture.test/existing.png"
		}
		if i == 4 {
			row.Category = "other"
		}
		if err := db.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
	}
	f := &fakeCoverGenerator{db: db}
	return &coverBatchService{db: db, generator: f, worker: "worker-A"}, f
}
func readCoverBatch(t *testing.T, s *coverBatchService, id idgen.ID) model.TemplateCoverBatch {
	t.Helper()
	var b model.TemplateCoverBatch
	if err := s.db.First(&b, "id = ?", id).Error; err != nil {
		t.Fatal(err)
	}
	return b
}
func tickCover(t *testing.T, s *coverBatchService) {
	t.Helper()
	if err := s.tick(context.Background()); err != nil {
		t.Fatal(err)
	}
}

func TestCoverBatchQuotesIdempotenceLeaseAndNonOverwrite(t *testing.T) {
	s, f := coverFixture(t)
	ctx := context.Background()
	filter := coverBatchFilter{Category: "food"}
	p, err := s.preview(ctx, 42, filter)
	if err != nil || p.Count != 2 || p.ModelName != "Cover enabled" || p.UnitCost != 7 || p.TotalCost != 14 {
		t.Fatal(p, err)
	}
	if _, err = s.create(ctx, 42, filter, "bad", "bad"); err == nil {
		t.Fatal("forged quote accepted")
	}
	b, err := s.create(ctx, 42, filter, p.QuoteToken, "run1")
	if err != nil {
		t.Fatal(err)
	}
	replayed, err := s.create(ctx, 42, filter, p.QuoteToken, "run1")
	if err != nil || replayed.ID != b.ID {
		t.Fatal("duplicate batch", err)
	}
	if _, err = s.create(ctx, 42, filter, p.QuoteToken, "run2"); err == nil {
		t.Fatal("overlapping batch accepted")
	}
	tickCover(t, s)
	batch := readCoverBatch(t, s, b.ID)
	if batch.Items[0].Description != "description" || batch.Items[0].Category != "food" || batch.Items[0].TaskID == 0 {
		t.Fatal("snapshot/task not persisted", batch.Items[0])
	}
	other := *s
	other.worker = "worker-B"
	tickCover(t, &other)
	if f.calls != 1 {
		t.Fatal("second worker submitted twice")
	}
	if err := s.db.Model(&model.StudioTemplate{}).Where("id = ?", 2).Update("cover_url", "https://fixture.test/manual.png").Error; err != nil {
		t.Fatal(err)
	}
	if err := s.db.Model(&model.AiTask{}).Where("id = ?", batch.Items[0].TaskID).Updates(map[string]any{"status": ai.TaskSuccess, "result_url": "https://fixture.test/generated.png"}).Error; err != nil {
		t.Fatal(err)
	}
	for range 3 {
		tickCover(t, s)
	}
	batch = readCoverBatch(t, s, b.ID)
	if batch.Status != "completed" || batch.ActiveKey != nil || batch.Items[0].Status != "succeeded" || batch.Items[1].Status != "skipped" {
		t.Fatal("wrong completion", batch)
	}
	var row model.StudioTemplate
	s.db.First(&row, 1)
	if row.CoverURL != "https://fixture.test/generated.png" || row.Status != 0 || row.Prompt != "PRIVATE_RECIPE" {
		t.Fatal("cover write overwrote template")
	}
	s.db.First(&row, "id = ?", 1)
	var second model.StudioTemplate
	s.db.First(&second, 2)
	if second.CoverURL != "https://fixture.test/manual.png" {
		t.Fatal("manual cover overwritten")
	}
	var owner model.User
	s.db.First(&owner, 42)
	if owner.Points != 93 || f.calls != 1 {
		t.Fatal("duplicate charge", owner.Points, f.calls)
	}
}

func TestCoverBatchRecoversLostSubmissionAcrossRestartAndStop(t *testing.T) {
	s, f := coverFixture(t)
	ctx := context.Background()
	filter := coverBatchFilter{Category: "food"}
	p, _ := s.preview(ctx, 42, filter)
	b, err := s.create(ctx, 42, filter, p.QuoteToken, "lost")
	if err != nil {
		t.Fatal(err)
	}
	f.lose = true
	tickCover(t, s)
	batch := readCoverBatch(t, s, b.ID)
	if batch.Items[0].TaskID != 0 || f.calls != 1 {
		t.Fatal("not exercising lost response")
	}
	if err := s.db.Model(&batch).Updates(map[string]any{"stop_requested": true, "lease_until": time.Now().Add(-time.Minute)}).Error; err != nil {
		t.Fatal(err)
	}
	restarted := *s
	restarted.worker = "restarted-worker"
	tickCover(t, &restarted)
	batch = readCoverBatch(t, s, b.ID)
	if batch.Items[0].TaskID == 0 || f.calls != 1 {
		t.Fatal("lost task charged again")
	}
	if err := s.db.Model(&model.StudioTemplate{}).Where("id = ?", 1).Update("title", "Operator edited title").Error; err != nil {
		t.Fatal(err)
	}
	s.db.Model(&model.AiTask{}).Where("id = ?", batch.Items[0].TaskID).Updates(map[string]any{"status": ai.TaskSuccess, "result_url": "https://fixture.test/unused.png"})
	for range 3 {
		tickCover(t, &restarted)
	}
	batch = readCoverBatch(t, s, b.ID)
	if batch.Status != "stopped" || batch.Items[0].Status != "skipped" || batch.Items[0].ResultURL == "" || batch.Items[1].Status != "skipped" {
		t.Fatal("stop/manual edit did not preserve work", batch)
	}
	var row model.StudioTemplate
	s.db.First(&row, 1)
	if row.CoverURL != "" || row.Title != "Operator edited title" {
		t.Fatal("changed template overwritten")
	}
	var owner model.User
	s.db.First(&owner, 42)
	if owner.Points != 93 || f.calls != 1 {
		t.Fatal("lost-response recovery double charged")
	}
	r := gin.New()
	r.Use(func(c *gin.Context) { c.Set(middleware.CtxUserID, idgen.ID(43)) })
	r.GET("/:batchId", s.getHTTP)
	r.POST("/:batchId/stop", s.stopHTTP)
	for _, method := range []string{"GET", "POST"} {
		path := "/" + b.ID.String()
		if method == "POST" {
			path += "/stop"
		}
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(method, path, nil))
		if strings.Contains(w.Body.String(), `"success":true`) {
			t.Fatal("other admin accessed the batch", method)
		}
	}
}

func TestCoverBatchUsesSpendableBalanceAndRejectsChangedQuotes(t *testing.T) {
	s, _ := coverFixture(t)
	ctx := context.Background()
	filter := coverBatchFilter{Category: "food"}
	s.db.Model(&model.User{}).Where("id = ?", 42).Update("point_held_micros", int64(95)*model.PointScale)
	p, err := s.preview(ctx, 42, filter)
	if err != nil || p.Balance != 5 {
		t.Fatal("held points counted as spendable", p, err)
	}
	if _, err = s.create(ctx, 42, filter, p.QuoteToken, "insufficient"); err == nil {
		t.Fatal("insufficient spendable balance accepted")
	}
	s.db.Model(&model.User{}).Where("id = ?", 42).Update("point_held_micros", 0)
	s.db.Model(&model.StudioTemplate{}).Where("id = ?", 1).Update("description", "changed")
	if _, err = s.create(ctx, 42, filter, p.QuoteToken, "stale"); err == nil {
		t.Fatal("changed recipe accepted with old quote")
	}
}

func TestCoverBatchContinuesAfterGenerationFailureWithoutAutomaticRetry(t *testing.T) {
	s, f := coverFixture(t)
	ctx := context.Background()
	filter := coverBatchFilter{Category: "food"}
	p, _ := s.preview(ctx, 42, filter)
	b, err := s.create(ctx, 42, filter, p.QuoteToken, "partial")
	if err != nil {
		t.Fatal(err)
	}
	tickCover(t, s)
	batch := readCoverBatch(t, s, b.ID)
	if err := s.db.Model(&model.AiTask{}).Where("id = ?", batch.Items[0].TaskID).Update("status", ai.TaskFailed).Error; err != nil {
		t.Fatal(err)
	}
	tickCover(t, s)
	tickCover(t, s)
	batch = readCoverBatch(t, s, b.ID)
	if batch.Items[0].Status != "failed" || batch.Items[1].TaskID == 0 || f.calls != 2 {
		t.Fatal("partial failure stopped batch or retried a charged task")
	}
	s.db.Model(&model.AiTask{}).Where("id = ?", batch.Items[1].TaskID).Updates(map[string]any{"status": ai.TaskSuccess, "result_url": "https://fixture.test/second.png"})
	tickCover(t, s)
	tickCover(t, s)
	batch = readCoverBatch(t, s, b.ID)
	if batch.Status != "completed" || batch.Items[1].Status != "succeeded" || f.calls != 2 {
		t.Fatal("remaining cover did not complete")
	}
}
