package ai

import (
	"context"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

type recoveryTestProvider struct{ resumes int }

func (p *recoveryTestProvider) Type() string { return "test" }
func (p *recoveryTestProvider) Generate(context.Context, GenerateRequest) (GenerateResult, error) {
	return GenerateResult{}, nil
}
func (p *recoveryTestProvider) Resume(_ context.Context, req ResumeRequest) (GenerateResult, error) {
	p.resumes++
	return GenerateResult{
		ResultURL:      "https://cdn.example/recovered.png",
		URLs:           []string{"https://cdn.example/recovered.png"},
		UpstreamTaskID: req.UpstreamTaskID,
		RequestURL:     "https://relay.example/v1/tasks/" + req.UpstreamTaskID,
		HttpStatus:     200,
	}, nil
}

func TestTaskCanExecuteOnlyProcessing(t *testing.T) {
	if !taskCanExecute(&model.AiTask{Status: statusProcessing}) {
		t.Fatal("processing task was rejected")
	}
	for _, status := range []int{statusSuccess, statusFailed, statusCancelled} {
		if taskCanExecute(&model.AiTask{Status: status}) {
			t.Fatalf("terminal task status %d would still call provider", status)
		}
	}
}

func TestUpstreamTaskIDIsDurableAndOnlyFirstBatchTaskWins(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:upstream-task-id?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.AiTask{}); err != nil {
		t.Fatal(err)
	}
	const taskID idgen.ID = 88001
	old := time.Now().Add(-2 * time.Minute)
	if err := db.Create(&model.AiTask{ID: taskID, UserID: 1, Status: statusProcessing, UpdateTime: old}).Error; err != nil {
		t.Fatal(err)
	}
	const legacyTaskID idgen.ID = 88002
	if err := db.Create(&model.AiTask{ID: legacyTaskID, UserID: 1, Status: statusProcessing, UpdateTime: old}).Error; err != nil {
		t.Fatal(err)
	}
	r := newRepo(db)
	if err := r.recordUpstreamTask(context.Background(), taskID, "remote-first"); err != nil {
		t.Fatal(err)
	}
	if err := r.recordUpstreamTask(context.Background(), taskID, "remote-second"); err != nil {
		t.Fatal(err)
	}
	got, err := r.getTask(context.Background(), taskID)
	if err != nil || got == nil {
		t.Fatalf("get task: task=%#v err=%v", got, err)
	}
	if got.UpstreamTaskID != "remote-first" {
		t.Fatalf("upstream task id=%q, want first durable id", got.UpstreamTaskID)
	}
	rows, err := r.orphanedProcessingTasks(context.Background(), time.Now().Add(time.Second), 10)
	if err != nil || len(rows) != 1 || rows[0].ID != taskID {
		t.Fatalf("orphan rows=%#v err=%v", rows, err)
	}
	unrecoverable, err := r.unrecoverableProcessingTasks(context.Background(), time.Now().Add(time.Second), 10)
	if err != nil || len(unrecoverable) != 1 || unrecoverable[0].ID != legacyTaskID {
		t.Fatalf("unrecoverable rows=%#v err=%v", unrecoverable, err)
	}
	svc := &service{repo: r}
	failed, err := svc.failUnrecoverableOrphanedTasks(context.Background())
	if err != nil || failed != 1 {
		t.Fatalf("failed legacy orphans=%d err=%v", failed, err)
	}
	legacy, err := r.getTask(context.Background(), legacyTaskID)
	if err != nil || legacy == nil || legacy.Status != statusFailed || legacy.Progress != 100 {
		t.Fatalf("legacy task did not settle: task=%#v err=%v", legacy, err)
	}
}

func TestOrphanedTaskResumesWithoutCreatingAnotherGeneration(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:resume-orphan?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.AiTask{}, &model.AiGenerationLog{}, &model.MarketModel{}); err != nil {
		t.Fatal(err)
	}
	const taskID idgen.ID = 88101
	task := model.AiTask{
		ID: taskID, UserID: 1, Handler: "text_to_image", ModelName: "Recovered Image",
		Status: statusProcessing, Progress: 30, UpstreamTaskID: "remote-restart",
		Input: `{"prompt":"recover me"}`, CreateTime: time.Now().Add(-time.Minute),
		UpdateTime: time.Now().Add(-orphanResumeGrace - time.Second),
	}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	provider := &recoveryTestProvider{}
	svc := &service{repo: newRepo(db), registry: newHandlerRegistry(), provider: provider}
	svc.resumeOrphanedTask(task)

	got, err := svc.repo.getTask(context.Background(), taskID)
	if err != nil || got == nil {
		t.Fatalf("get recovered task: task=%#v err=%v", got, err)
	}
	if provider.resumes != 1 || got.Status != statusSuccess || got.Progress != 100 || got.ResultUrl != "https://cdn.example/recovered.png" {
		t.Fatalf("recovery provider=%d task=%#v", provider.resumes, got)
	}
	var logs int64
	if err := db.Model(&model.AiGenerationLog{}).Where("task_id = ?", taskID).Count(&logs).Error; err != nil || logs != 1 {
		t.Fatalf("recovery logs=%d err=%v", logs, err)
	}
}
