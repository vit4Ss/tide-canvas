package ai

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"tidecanvas/internal/handler/points"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

func TestPrivateSkillGenerationPersistsOnlyPublicInput(t *testing.T) {
	dto := generateDTO{IsAPICall: true, SkillRunID: 123,
		Input:       json.RawMessage(`{"prompt":"private-step-prompt","systemPrompt":"private-SKILL"}`),
		PublicInput: json.RawMessage(`{"prompt":"user request","imageUrls":["https://cdn.test/ref.png"]}`)}
	got := string(persistedGenerationInput(dto))
	if strings.Contains(got, "private-") || !strings.Contains(got, "user request") {
		t.Fatal(got)
	}
	if !strings.Contains(string(dto.Input), "private-SKILL") {
		t.Fatal("provider execution input was overwritten")
	}
	for _, change := range []func(*generateDTO){func(d *generateDTO) { d.IsAPICall = false }, func(d *generateDTO) { d.SkillRunID = 0 }} {
		copy := dto
		change(&copy)
		if string(persistedGenerationInput(copy)) != string(dto.Input) {
			t.Fatal("unrelated generation inputs changed")
		}
	}
}

func TestMCPSkillTaskDebitsOwnerOnceAndRefundsFailureOnce(t *testing.T) {
	db := concurrencyTestDB(t)
	if err := db.AutoMigrate(&model.SkillRun{}, &model.SkillRunStep{}, &model.PointRecord{}, &model.PointRefundReceipt{}); err != nil {
		t.Fatal(err)
	}
	owner := model.User{ID: 42, Username: "mcp-owner", Email: "owner@test", Status: 1, Points: 7}
	other := model.User{ID: 43, Username: "mcp-other", Email: "other@test", Status: 1, Points: 99}
	for _, user := range []*model.User{&owner, &other} {
		if err := db.Create(user).Error; err != nil {
			t.Fatal(err)
		}
	}
	run := model.SkillRun{UserID: owner.ID, EntryPoint: "mcp", Status: model.SkillRunRunning, WorkerID: "test-worker", Revision: 1}
	if err := db.Create(&run).Error; err != nil {
		t.Fatal(err)
	}
	step := model.SkillRunStep{RunID: run.ID, StepKey: "first", Status: model.SkillStepRunning}
	if err := db.Create(&step).Error; err != nil {
		t.Fatal(err)
	}
	dto := generateDTO{IsAPICall: true, SkillRunID: run.ID, SkillRunStepID: step.ID, SkillRunRevision: 1, SkillRunWorkerID: run.WorkerID}
	svc := &service{repo: newRepo(db)}
	makeTask := func(stepID idgen.ID) *model.AiTask {
		key := "skill-run-step:" + stepID.String()
		return &model.AiTask{ID: idgen.Next(), UserID: owner.ID, Status: statusProcessing, PointCost: 7, IsAPICall: true, SkillRunID: run.ID, SkillRunStepID: stepID, OrchestrationKey: &key, CreateTime: time.Now()}
	}
	task := makeTask(step.ID)
	if created, err := svc.createSkillRunTask(context.Background(), owner.ID, dto, task, 7, "model", 5); err != nil || !created {
		t.Fatalf("create=%v %v", created, err)
	}
	retry := makeTask(step.ID)
	if created, err := svc.createSkillRunTask(context.Background(), owner.ID, dto, retry, 7, "model", 5); err != nil || created || retry.ID != task.ID {
		t.Fatalf("retry double charged: %v %v", created, err)
	}
	var entries int64
	db.Model(&model.PointRecord{}).Count(&entries)
	db.First(&owner, owner.ID)
	db.First(&other, other.ID)
	if entries != 1 || owner.Points != 0 || other.Points != 99 {
		t.Fatalf("wrong ledger/owner: %d %d %d", entries, owner.Points, other.Points)
	}
	second := model.SkillRunStep{RunID: run.ID, StepKey: "second", Sequence: 1, Status: model.SkillStepRunning}
	if err := db.Create(&second).Error; err != nil {
		t.Fatal(err)
	}
	dto.SkillRunStepID = second.ID
	rejected := makeTask(second.ID)
	if created, err := svc.createSkillRunTask(context.Background(), owner.ID, dto, rejected, 7, "model", 5); created || !errors.Is(err, points.ErrInsufficient) {
		t.Fatalf("insufficient balance accepted: %v %v", created, err)
	}
	var tasks int64
	db.Model(&model.AiTask{}).Count(&tasks)
	if tasks != 1 {
		t.Fatalf("rejected debit left a task: %d", tasks)
	}
	if err := db.Model(task).Update("status", statusFailed).Error; err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err := refundTaskOnce(db, task.ID, "MCP failed"); err != nil {
			t.Fatal(err)
		}
	}
	db.First(&owner, owner.ID)
	db.Model(&model.PointRecord{}).Count(&entries)
	if owner.Points != 7 || entries != 2 {
		t.Fatalf("refund was not idempotent: balance=%d entries=%d", owner.Points, entries)
	}
}
