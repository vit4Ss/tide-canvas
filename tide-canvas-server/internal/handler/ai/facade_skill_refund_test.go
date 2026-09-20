package ai

import (
	"context"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"tidecanvas/internal/handler/points"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

func TestRefundFailedSkillRunRefundsSuccessfulChildrenExactlyOnce(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:skill-run-refund-"+idgen.Next().String()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.User{}, &model.AiTask{}, &model.PointRecord{}, &model.PointRefundReceipt{}, &model.SkillRun{}); err != nil {
		t.Fatal(err)
	}
	userID, runID, taskID := idgen.Next(), idgen.Next(), idgen.Next()
	if err := db.Create(&model.User{ID: userID, Username: "refund-user", Email: "refund@example.test", Points: 100, Status: 1}).Error; err != nil {
		t.Fatal(err)
	}
	if err := points.Consume(db, userID, 4, "技能步骤消费", taskID); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.SkillRun{BaseModel: model.BaseModel{ID: runID}, UserID: userID, SkillID: 1, SkillVersionID: 1, EntryPoint: "mcp", Status: model.SkillRunFailed, PointCost: 4}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.AiTask{ID: taskID, UserID: userID, Status: statusSuccess, PointCost: 4, SkillRunID: runID}).Error; err != nil {
		t.Fatal(err)
	}
	facade := &GenerationFacade{svc: &service{repo: newRepo(db)}}
	if err := facade.RefundFailedSkillRun(context.Background(), runID); err != nil {
		t.Fatal(err)
	}
	if err := facade.RefundFailedSkillRun(context.Background(), runID); err != nil {
		t.Fatal(err)
	}
	var user model.User
	var task model.AiTask
	var run model.SkillRun
	if err := db.First(&user, "id = ?", userID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&task, "id = ?", taskID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&run, "id = ?", runID).Error; err != nil {
		t.Fatal(err)
	}
	if user.Points != 100 || !task.Refunded || run.PointCost != 0 {
		t.Fatalf("refund state user=%d task.refunded=%v run.cost=%d", user.Points, task.Refunded, run.PointCost)
	}
	var refunds int64
	if err := db.Model(&model.PointRecord{}).Where("user_id = ? AND change_type = ? AND ref_id = ?", userID, points.ChangeRefund, taskID).Count(&refunds).Error; err != nil {
		t.Fatal(err)
	}
	if refunds != 1 {
		t.Fatalf("refund ledger count=%d", refunds)
	}
}

func TestRefundFailedSkillRunDoesNotRefundSuccessfulParent(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:successful-skill-run-"+idgen.Next().String()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.User{}, &model.AiTask{}, &model.PointRecord{}, &model.PointRefundReceipt{}, &model.SkillRun{}); err != nil {
		t.Fatal(err)
	}
	userID, runID, taskID := idgen.Next(), idgen.Next(), idgen.Next()
	if err := db.Create(&model.User{ID: userID, Username: "paid-user", Email: "paid@example.test", Points: 96, Status: 1}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.SkillRun{BaseModel: model.BaseModel{ID: runID}, UserID: userID, SkillID: 1, SkillVersionID: 1, EntryPoint: "mcp", Status: model.SkillRunSucceeded, PointCost: 4}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.AiTask{ID: taskID, UserID: userID, Status: statusSuccess, PointCost: 4, SkillRunID: runID}).Error; err != nil {
		t.Fatal(err)
	}
	facade := &GenerationFacade{svc: &service{repo: newRepo(db)}}
	if err := facade.RefundFailedSkillRun(context.Background(), runID); err != nil {
		t.Fatal(err)
	}
	var task model.AiTask
	if err := db.First(&task, "id = ?", taskID).Error; err != nil {
		t.Fatal(err)
	}
	if task.Refunded {
		t.Fatal("successful parent task was refunded")
	}
}
