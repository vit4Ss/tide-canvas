package ai

import (
	"context"
	"errors"
	"testing"
	"time"

	"tidecanvas/internal/handler/points"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

func TestPaidSocialReportCreatesTaskWithoutSecondModelCharge(t *testing.T) {
	db := concurrencyTestDB(t)
	if err := db.AutoMigrate(&model.SocialActivityRecord{}, &model.Skill{}, &model.SkillRun{}, &model.SkillRunStep{}, &model.PointRecord{}, &model.PointRefundReceipt{}); err != nil {
		t.Fatal(err)
	}
	user := model.User{ID: 42, Username: "prepaid-report", Points: 1}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	skill := model.Skill{SeedKey: "tool-account-analysis"}
	if err := db.Create(&skill).Error; err != nil {
		t.Fatal(err)
	}
	// Billing must survive edited/missing input parameters.
	run := model.SkillRun{UserID: 42, SkillID: skill.ID, Status: model.SkillRunRunning, WorkerID: "billing-worker", Revision: 1, SocialActivityID: 123, Input: `{}`}
	if err := db.Create(&run).Error; err != nil {
		t.Fatal(err)
	}
	step := model.SkillRunStep{RunID: run.ID, Status: model.SkillStepRunning}
	if err := db.Create(&step).Error; err != nil {
		t.Fatal(err)
	}
	r := model.SocialActivityRecord{ID: 123, UserID: 42, ActivityType: model.SocialActivityAnalysis, Status: model.SocialActivitySucceeded, AnalysisRunID: run.ID}
	if _, err := points.BeginSocial(db, &r, "paid-parse"); err != nil {
		t.Fatal(err)
	}
	key := "social-report-step"
	makeTask := func() *model.AiTask {
		task := &model.AiTask{UserID: 42, Status: statusProcessing, PointCost: 99, SkillRunID: run.ID, SkillRunStepID: step.ID, OrchestrationKey: &key}
		task.ID = idgen.Next()
		task.CreateTime = time.Now()
		return task
	}
	task := makeTask()
	dto := generateDTO{Handler: skillTextCompletionHandler, SkillRunID: run.ID, SkillRunStepID: step.ID, SkillRunRevision: 1, SkillRunWorkerID: run.WorkerID}
	s := &service{repo: newRepo(db)}
	if created, err := s.createSkillRunTask(context.Background(), 42, dto, task, 99, "priced-model", 5); err != nil || !created {
		t.Fatalf("create=%v %v", created, err)
	}
	if task.PointCost != 0 {
		t.Fatalf("double model charge: %d", task.PointCost)
	}
	retry := makeTask()
	if created, err := s.createSkillRunTask(context.Background(), 42, dto, retry, 99, "priced-model", 5); err != nil || created || retry.ID != task.ID {
		t.Fatalf("replay=%v %+v %v", created, retry, err)
	}
	var ledgerCount int64
	db.Model(&model.PointRecord{}).Count(&ledgerCount)
	db.First(&user, user.ID)
	if ledgerCount != 1 || user.Points != 0 {
		t.Fatalf("ledger=%d balance=%d", ledgerCount, user.Points)
	}
	db.Model(&run).Update("status", model.SkillRunFailed)
	if err := points.RefundFailedSocialRun(db, run.ID); err != nil {
		t.Fatal(err)
	}
	db.First(&user, user.ID)
	if user.Points != 1 {
		t.Fatalf("refund must use bundled price, got %d", user.Points)
	}
}

func TestSocialTaskBillingFailsClosedWhenPaidLinkIsInvalid(t *testing.T) {
	for _, state := range []string{"missing", "foreign", "refunded", "unpaid"} {
		t.Run(state, func(t *testing.T) {
			db := concurrencyTestDB(t)
			if err := db.AutoMigrate(&model.SocialActivityRecord{}, &model.SkillRun{}, &model.SkillRunStep{}, &model.PointRecord{}); err != nil {
				t.Fatal(err)
			}
			user := model.User{ID: 42, Username: "invalid-grant", Points: 100}
			if err := db.Create(&user).Error; err != nil {
				t.Fatal(err)
			}
			run := model.SkillRun{UserID: 42, Status: model.SkillRunRunning, WorkerID: "worker", Revision: 1, SocialActivityID: 123, Input: `{}`}
			if err := db.Create(&run).Error; err != nil {
				t.Fatal(err)
			}
			step := model.SkillRunStep{RunID: run.ID, Status: model.SkillStepRunning}
			if err := db.Create(&step).Error; err != nil {
				t.Fatal(err)
			}
			if state != "missing" {
				r := model.SocialActivityRecord{ID: 123, UserID: 42, ActivityType: model.SocialActivityAnalysis, Status: model.SocialActivitySucceeded, PointCost: 1, AnalysisRunID: run.ID}
				if state == "foreign" {
					r.UserID = 43
				}
				if state == "refunded" {
					r.Refunded = true
				}
				if state == "unpaid" {
					r.PointCost = 0
				}
				if err := db.Create(&r).Error; err != nil {
					t.Fatal(err)
				}
			}
			key := "invalid-social-report"
			task := &model.AiTask{ID: idgen.Next(), UserID: 42, Status: statusProcessing, PointCost: 99, SkillRunID: run.ID, SkillRunStepID: step.ID, OrchestrationKey: &key}
			dto := generateDTO{Handler: skillTextCompletionHandler, SkillRunID: run.ID, SkillRunStepID: step.ID, SkillRunRevision: 1, SkillRunWorkerID: run.WorkerID}
			s := &service{repo: newRepo(db)}
			if created, err := s.createSkillRunTask(context.Background(), 42, dto, task, 99, "priced-model", 5); created || !errors.Is(err, points.ErrSocialUnavailable) {
				t.Fatalf("invalid grant fell back to model billing: created=%v err=%v", created, err)
			}
			var count int64
			if err := db.Model(&model.AiTask{}).Count(&count).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.First(&user, user.ID).Error; err != nil {
				t.Fatal(err)
			}
			if count != 0 || user.Points != 100 {
				t.Fatalf("tasks=%d balance=%d", count, user.Points)
			}
		})
	}
}
