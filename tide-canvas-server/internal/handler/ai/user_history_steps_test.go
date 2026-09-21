package ai

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

func TestUserGenerationHistoryIncludesPaidSkillStepsAndResults(t *testing.T) {
	db := concurrencyTestDB(t)
	if err := db.AutoMigrate(&model.AiGenerationLog{}, &model.SkillRun{}, &model.PointRecord{}); err != nil {
		t.Fatal(err)
	}
	run := model.SkillRun{UserID: 42, EntryPoint: "mcp", Input: `{"prompt":"审查这个视频","assets":[{"type":"video","url":"https://cdn.example/clip.mp4"}],"parameters":{"systemPrompt":"private-configuration","resolution":"1080p"}}`}
	if err := db.Create(&run).Error; err != nil {
		t.Fatal(err)
	}
	handlers := []string{skillTextCompletionHandler, "text_to_image", "text_to_video", "text_to_audio"}
	for i, handler := range handlers {
		id := idgen.ID(800 + i)
		result := `{"text":"review findings","provider":"private-provider","systemPrompt":"private-prompt"}`
		url := ""
		if i > 0 {
			url = []string{"", "https://cdn.example/image.png", "https://cdn.example/video.mp4", "https://cdn.example/audio.mp3"}[i]
			result = `{"urls":["` + url + `"],"provider":"private-provider"}`
		}
		task := model.AiTask{ID: id, UserID: 42, Handler: handler, Status: statusSuccess, PointCost: 8, IsAPICall: true, Origin: "skill_run", SkillRunID: run.ID, OutputRole: "intermediate", RegisterWork: false, Input: `{"prompt":"private-execution-prompt","systemPrompt":"private-SKILL"}`, ResultMeta: result, ResultUrl: url, Refunded: true}
		if i == 3 {
			task.IsAPICall = false
			task.OutputRole = "final"
		} // same accounting rule for an in-site Agent Skill
		if err := db.Create(&task).Error; err != nil {
			t.Fatal(err)
		}
		log := model.AiGenerationLog{ID: id, TaskID: id, UserID: 42, HandlerName: handler, Model: "generation model", Success: 1, IsAPICall: task.IsAPICall, InputParams: task.Input, ResponseBody: "private-response"}
		if err := db.Create(&log).Error; err != nil {
			t.Fatal(err)
		}
	}
	// One successful step got a real refund. The other tasks carry the old
	// refunded=true settlement flag but have no returned points.
	ref := idgen.ID(800)
	if err := db.Create(&model.PointRecord{UserID: 42, RefID: &ref, ChangeType: "refund", Amount: 8}).Error; err != nil {
		t.Fatal(err)
	}
	// Another user's refund with a colliding ref cannot affect this account.
	if err := db.Create(&model.PointRecord{UserID: 43, RefID: &ref, ChangeType: "refund", Amount: 900}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.AiGenerationLog{ID: 900, UserID: 43, HandlerName: skillTextCompletionHandler, Success: 1}).Error; err != nil {
		t.Fatal(err)
	}
	svc := &service{repo: newRepo(db)}
	rows, total, err := svc.listUserHistory(context.Background(), 42, userHistoryQuery{}, 0, 20)
	if err != nil || total != 4 || len(rows) != 4 {
		t.Fatalf("history %d %+v %v", total, rows, err)
	}
	for _, row := range rows {
		if row.Prompt != "审查这个视频" || row.PointCost == nil || *row.PointCost != 8 || row.WorkflowStage == "" {
			t.Fatalf("missing safe history: %+v", row)
		}
		if (row.ID == 800 && row.RefundedPoints != 8) || (row.ID != 800 && row.RefundedPoints != 0) {
			t.Fatalf("refund proof is wrong: %+v", row)
		}
		detail, err := svc.getUserHistory(context.Background(), 42, row.ID)
		if err != nil {
			t.Fatal(err)
		}
		raw, _ := json.Marshal(detail)
		if strings.Contains(string(raw), "private-") {
			t.Fatalf("private workflow leaked: %s", raw)
		}
		if row.ID == 800 && detail.ResultText != "review findings" {
			t.Fatal("text result missing")
		}
		if row.ID != 800 && len(detail.ResultAssets) != 1 {
			t.Fatalf("media missing: %+v", detail)
		}
		if len(detail.InputAssets) != 1 || detail.InputAssets[0].Kind != "video" {
			t.Fatal("original user input missing")
		}
	}
	if _, err := svc.getUserHistory(context.Background(), 43, 800); err != errTaskNotFound {
		t.Fatal("another user could read the step")
	}
	filtered, count, err := svc.listUserHistory(context.Background(), 42, userHistoryQuery{MediaType: "text"}, 0, 20)
	if err != nil || count != 1 || len(filtered) != 1 || filtered[0].ID != 800 {
		t.Fatalf("text filter failed: %v %v", filtered, err)
	}
	if _, total, err := svc.listUserHistory(context.Background(), 42, userHistoryQuery{Keyword: "private-execution"}, 0, 20); err != nil || total != 0 {
		t.Fatalf("search matched private skill instructions: total=%d error=%v", total, err)
	}
	// Existing studio/gallery task visibility remains final-artifact based.
	var visible int64
	if err := visibleTaskHistoryScope(db.Model(&model.AiTask{}).Where("user_id = ?", 42)).Count(&visible).Error; err != nil {
		t.Fatal(err)
	}
	if visible != 0 {
		t.Fatal("intermediate workflow artifacts entered the studio asset feed")
	}
	// Reads do not cause generation, billing or refund writes.
	var ledgerCount int64
	db.Model(&model.PointRecord{}).Count(&ledgerCount)
	if ledgerCount != 2 {
		t.Fatal("history read changed billing")
	}
}

func TestSkillHistoryKeepsTheInputSnapshotAfterRunRevisionAndTaskDeletion(t *testing.T) {
	db := concurrencyTestDB(t)
	if err := db.AutoMigrate(&model.AiGenerationLog{}, &model.PointRecord{}); err != nil {
		t.Fatal(err)
	}
	cost := int64(8)
	task := model.AiTask{ID: 777, UserID: 42, Origin: "skill_run", SkillRunID: 555, OutputRole: "final", Status: statusSuccess, PointCost: cost, Handler: skillTextCompletionHandler, Input: `{"prompt":"later private input"}`, ResultMeta: `{"text":"report"}`}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	log := model.AiGenerationLog{ID: 777, TaskID: task.ID, UserID: 42, Origin: "skill_run", OutputRole: "final", HandlerName: task.Handler, PointCost: &cost, InputSanitized: true, InputParams: `{"prompt":"original user input"}`, Success: 1, PublicResult: `{"text":"report","assets":[]}`}
	if err := db.Create(&log).Error; err != nil {
		t.Fatal(err)
	}
	svc := &service{repo: newRepo(db)}
	for phase := 0; phase < 3; phase++ {
		if phase == 1 {
			if err := db.Delete(&task).Error; err != nil {
				t.Fatal(err)
			}
		}
		if phase == 2 {
			if err := db.Unscoped().Delete(&task).Error; err != nil {
				t.Fatal(err)
			}
		}
		d, err := svc.getUserHistory(context.Background(), 42, 777)
		if err != nil || d.Prompt != "original user input" || d.ResultText != "report" || d.PointCost == nil || *d.PointCost != 8 {
			t.Fatalf("phase %d: %+v %v", phase, d, err)
		}
	}
}

func TestGenerationHistorySnapshotSurvivesTaskRemoval(t *testing.T) {
	cost := int64(12)
	result := GenerateResult{Meta: map[string]any{"text": "final report", "secret": "never expose"}}
	log := model.AiGenerationLog{PointCost: &cost, IsAPICall: true, Origin: "skill_run", OutputRole: "final", HandlerName: skillTextCompletionHandler, Success: 1}
	log.PublicResult = publicGenerationSnapshot(&model.AiTask{}, result, skillTextCompletionHandler, "text")
	detail := toUserHistoryDetail(&log, nil)
	if detail.ResultText != "final report" || detail.PointCost == nil || *detail.PointCost != 12 || detail.WorkflowStage != "final" {
		t.Fatalf("orphaned result lost: %+v", detail)
	}
	if strings.Contains(log.PublicResult, "never expose") {
		t.Fatal("private metadata entered snapshot")
	}
}
