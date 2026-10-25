package ai

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
	"time"
)

func waitCoverTask(t *testing.T, f *GenerationFacade, id idgen.ID, want int) {
	t.Helper()
	deadline := time.Now().Add(4 * time.Second)
	for time.Now().Before(deadline) {
		task, err := f.Get(context.Background(), 42, id)
		if err != nil {
			t.Fatal(err)
		}
		if task.Status == want {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("cover task did not reach expected status", want)
}

func TestTemplateCoverOptInPriceGuardAndIdempotentDebit(t *testing.T) {
	s, row, provider := templateFixture(t)
	ctx := context.Background()
	if _, err := PlanTemplateCover(ctx, s.repo.db, *row); err == nil {
		t.Fatal("ordinary image model enabled batch covers by default")
	}
	cfg := `{"templateCoverBatch":true,"modes":["t2i"],"ratios":["1:1","16:9"],"resolutions":["2k"],"qualities":["high"],"priceMatrix":{"high":{"2k":19}}}`
	if err := s.repo.db.Model(&model.MarketModel{}).Where("model_key = ?", "fixture-image").Update("config", cfg).Error; err != nil {
		t.Fatal(err)
	}
	plan, err := PlanTemplateCover(ctx, s.repo.db, *row)
	if err != nil || plan.PointCost != 19 || plan.Input["aspectRatio"] != "16:9" || strings.Contains(plan.Input["prompt"].(string), row.Prompt) {
		t.Fatal("wrong cover plan", plan, err)
	}
	f := &GenerationFacade{svc: s}
	cmd := GenerationCommand{ClientRequestID: "cover-proof", TemplateCoverModelHash: plan.ModelHash, ModelID: plan.ModelID, Handler: "text_to_image", Input: plan.Input, RegisterWork: false}
	id, err := f.Submit(ctx, 42, cmd)
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-provider.seen:
	case <-time.After(4 * time.Second):
		t.Fatal("not dispatched")
	}
	deadline := time.Now().Add(4 * time.Second)
	for time.Now().Before(deadline) {
		snap, e := f.Get(ctx, 42, id)
		if e != nil {
			t.Fatal(e)
		}
		if snap.Status == TaskSuccess {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if err := s.repo.db.Model(&model.MarketModel{}).Where("model_key = ?", "fixture-image").Update("config", strings.Replace(cfg, `"templateCoverBatch":true`, `"templateCoverBatch":false`, 1)).Error; err != nil {
		t.Fatal(err)
	}
	replayed, err := f.Submit(ctx, 42, cmd)
	if err != nil || replayed != id {
		t.Fatal("accepted batch could not be recovered after configuration change", err)
	}
	bad := cmd
	bad.Input = map[string]any{"prompt": "different request", "batchCount": 1}
	if _, found, e := f.Recover(ctx, 42, bad); !found || e == nil {
		t.Fatal("recovery accepted a client ID with a different fingerprint")
	}
	ordinary := cmd
	ordinary.TemplateCoverModelHash = ""
	if _, found, e := f.Recover(ctx, 42, ordinary); !found || e == nil {
		t.Fatal("batch fingerprint accepted a different billing context")
	}
	cmd.ClientRequestID = "new-cover-after-disable"
	if _, err = f.Submit(ctx, 42, cmd); err == nil {
		t.Fatal("disabled model accepted a new batch cover")
	}
	var owner model.User
	if err := s.repo.db.First(&owner, 42).Error; err != nil || owner.Points != 81 {
		t.Fatal("wrong/double debit", owner.Points, err)
	}
	// Price changes also invalidate a previously approved batch, even if the
	// switch stays enabled.
	if err := s.repo.db.Model(&model.MarketModel{}).Where("model_key = ?", "fixture-image").Update("config", strings.Replace(cfg, "19", "25", 1)).Error; err != nil {
		t.Fatal(err)
	}
	cmd.ClientRequestID = "new-cover-after-price-change"
	if _, err = f.Submit(ctx, 42, cmd); err == nil {
		t.Fatal("changed price accepted without reconfirmation")
	}
	cmd.TemplateCoverModelHash = ""
	cmd.ClientRequestID = "ordinary-image-still-works"
	normalID, err := f.Submit(ctx, 42, cmd)
	if err != nil {
		t.Fatal("batch guard affected normal image generation", err)
	}
	select {
	case <-provider.seen:
	case <-time.After(4 * time.Second):
		t.Fatal("normal image not dispatched")
	}
	waitCoverTask(t, f, normalID, TaskSuccess)
}

func TestTemplateCoverFailureRefundsAndDoesNotResubmit(t *testing.T) {
	s, row, provider := templateFixture(t)
	ctx := context.Background()
	provider.failure = errors.New("fixture provider rejected")
	if err := s.repo.db.Model(&model.MarketModel{}).Where("model_key = ?", "fixture-image").Update("config", `{"templateCoverBatch":true,"modes":["t2i"]}`).Error; err != nil {
		t.Fatal(err)
	}
	plan, err := PlanTemplateCover(ctx, s.repo.db, *row)
	if err != nil {
		t.Fatal(err)
	}
	f := &GenerationFacade{svc: s}
	cmd := GenerationCommand{ClientRequestID: "failed-cover", TemplateCoverModelHash: plan.ModelHash, ModelID: plan.ModelID, Handler: "text_to_image", Input: plan.Input}
	id, err := f.Submit(ctx, 42, cmd)
	if err != nil {
		t.Fatal(err)
	}
	waitCoverTask(t, f, id, TaskFailed)
	replayed, err := f.Submit(ctx, 42, cmd)
	if err != nil || replayed != id {
		t.Fatal("failed task was resubmitted", err)
	}
	var owner model.User
	if err := s.repo.db.First(&owner, 42).Error; err != nil || owner.Points != 100 {
		t.Fatal("failed cover not refunded", owner.Points, err)
	}
	if len(provider.seen) != 1 {
		t.Fatal("upstream called again")
	}
}

func TestTemplateCoverBatchFencesWalletDebitAgainstStopAndLeaseLoss(t *testing.T) {
	for _, scenario := range []string{"stopped", "expired", "other-worker", "completed", "covered", "edited", "wrong-input", "wrong-price", "inactive-owner", "accepted"} {
		t.Run(scenario, func(t *testing.T) {
			s, row, provider := templateFixture(t)
			ctx := context.Background()
			if err := s.repo.db.AutoMigrate(&model.TemplateCoverBatch{}); err != nil {
				t.Fatal(err)
			}
			if err := s.repo.db.Model(&model.MarketModel{}).Where("model_key = ?", "fixture-image").Update("config", `{"templateCoverBatch":true,"modes":["t2i"]}`).Error; err != nil {
				t.Fatal(err)
			}
			plan, err := PlanTemplateCover(ctx, s.repo.db, *row)
			if err != nil {
				t.Fatal(err)
			}
			key := "studio-template-covers"
			lease := time.Now().Add(time.Minute)
			batch := model.TemplateCoverBatch{UserID: 42, RequestID: "fence", ActiveKey: &key, ModelID: plan.ModelID, ModelHash: plan.ModelHash, UnitCost: plan.PointCost, Status: "running", Worker: "worker-A", LeaseUntil: &lease, Items: []model.TemplateCoverItem{{TemplateID: row.ID, Title: row.Title, Description: row.Description, Category: row.Category, Input: plan.Input, Status: "pending"}}}
			if err := s.repo.db.Create(&batch).Error; err != nil {
				t.Fatal(err)
			}
			cmd := GenerationCommand{ClientRequestID: fmt.Sprintf("template-cover:%s:%s", batch.ID, row.ID), TemplateCoverModelHash: plan.ModelHash, TemplateCoverBatchID: batch.ID, TemplateCoverTemplateID: row.ID, TemplateCoverWorker: "worker-A", ModelID: plan.ModelID, Handler: "text_to_image", Input: plan.Input}
			updateBatch := func(field string, value any) {
				t.Helper()
				if err := s.repo.db.Model(&batch).Update(field, value).Error; err != nil {
					t.Fatal(err)
				}
			}
			updateRow := func(field string, value any) {
				t.Helper()
				if err := s.repo.db.Model(row).Update(field, value).Error; err != nil {
					t.Fatal(err)
				}
			}
			switch scenario {
			case "stopped":
				updateBatch("stop_requested", true)
			case "expired":
				updateBatch("lease_until", time.Now().Add(-time.Second))
			case "other-worker":
				updateBatch("worker", "worker-B")
			case "completed":
				updateBatch("active_key", nil)
				updateBatch("status", "completed")
			case "covered":
				updateRow("cover_url", "https://fixture.test/manual.png")
			case "edited":
				updateRow("title", "Changed")
			case "wrong-input":
				cmd.Input = map[string]any{"prompt": "another brief", "batchCount": 1}
			case "wrong-price":
				updateBatch("unit_cost", plan.PointCost+1)
			case "inactive-owner":
				if err := s.repo.db.Model(&model.User{}).Where("id = ?", 42).Update("status", 0).Error; err != nil {
					t.Fatal(err)
				}
			}
			f := &GenerationFacade{svc: s}
			id, err := f.Submit(ctx, 42, cmd)
			if scenario != "accepted" {
				if err == nil {
					t.Fatal("unauthorized charge accepted", scenario)
				}
				var count int64
				s.repo.db.Model(&model.AiTask{}).Count(&count)
				var owner model.User
				s.repo.db.First(&owner, 42)
				if count != 0 || owner.Points != 100 || len(provider.seen) != 0 {
					t.Fatal("rejected batch created a task or charged", scenario)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			waitCoverTask(t, f, id, TaskSuccess)
			updateBatch("stop_requested", true)
			updateBatch("worker", "worker-B")
			cmd.TemplateCoverWorker = "worker-B"
			recovered, found, err := f.Recover(ctx, 42, cmd)
			if err != nil || !found || recovered != id {
				t.Fatal("accepted task could not recover after stop/worker change", err)
			}
			replayed, err := f.Submit(ctx, 42, cmd)
			if err != nil || replayed != id {
				t.Fatal("accepted task was charged again after stopping", err)
			}
			var owner model.User
			s.repo.db.First(&owner, 42)
			if owner.Points != int64(100-plan.PointCost) || len(provider.seen) != 1 {
				t.Fatal("incorrect debit count")
			}
		})
	}
}
