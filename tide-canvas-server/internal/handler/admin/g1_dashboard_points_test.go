package admin

import (
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

func TestDashboardPointConsumptionAggregates(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:dashboard_points?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("get sql db: %v", err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })

	if err := db.AutoMigrate(&model.User{}, &model.PointRecord{}, &model.ModelCallLog{}, &model.MarketModel{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	const (
		userOne idgen.ID = 101
		userTwo idgen.ID = 202
	)
	users := []model.User{
		{ID: userOne, Username: "alice", Email: "alice@example.test", Nickname: "Alice"},
		{ID: userTwo, Username: "bob", Email: "bob@example.test", Nickname: "Bob"},
	}
	if err := db.Create(&users).Error; err != nil {
		t.Fatalf("create users: %v", err)
	}

	now := time.Date(2026, 8, 7, 12, 0, 0, 0, time.Local)
	since := now.AddDate(0, 0, -13)
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	deletedAt := gorm.DeletedAt{Time: now.Add(-time.Hour), Valid: true}
	records := []model.PointRecord{
		{BaseModel: model.BaseModel{ID: 1001, CreateTime: now.AddDate(0, 0, -2)}, UserID: userOne, ChangeType: "consume", Amount: -12, Balance: 88, Remark: "image"},
		{BaseModel: model.BaseModel{ID: 1002, CreateTime: now.Add(-time.Hour)}, UserID: userOne, ChangeType: "consume", Amount: -8, Balance: 80, Remark: "chat"},
		{BaseModel: model.BaseModel{ID: 1003, CreateTime: now.AddDate(0, 0, -1)}, UserID: userTwo, ChangeType: "consume", Amount: -30, Balance: 70, Remark: "video"},
		// Refunds are positive ledger rows and must not reduce gross consumption.
		{BaseModel: model.BaseModel{ID: 1004, CreateTime: now.Add(-30 * time.Minute)}, UserID: userOne, ChangeType: "refund", Amount: 12, Balance: 92, Remark: "refund"},
		// Rows outside the reporting window and soft-deleted rows are excluded.
		{BaseModel: model.BaseModel{ID: 1005, CreateTime: since.Add(-time.Hour)}, UserID: userOne, ChangeType: "consume", Amount: -50, Balance: 38, Remark: "old"},
		{BaseModel: model.BaseModel{ID: 1006, CreateTime: now.Add(-2 * time.Hour), Deleted: deletedAt}, UserID: userTwo, ChangeType: "consume", Amount: -100, Balance: 0, Remark: "deleted"},
	}
	if err := db.Create(&records).Error; err != nil {
		t.Fatalf("create point records: %v", err)
	}

	h := &dashboardHandler{db: db}
	summary := h.pointSummary(since, today)
	if summary.TodayPoints != 8 || summary.PeriodPoints != 50 || summary.PeriodUsers != 2 || summary.PeriodRecords != 3 {
		t.Fatalf("unexpected point summary: %+v", summary)
	}

	userTop := h.topPointUsers(since, 8)
	if len(userTop) != 2 {
		t.Fatalf("top users length = %d, want 2", len(userTop))
	}
	if userTop[0].UserID != userTwo.String() || userTop[0].Points != 30 || userTop[0].Records != 1 || userTop[0].Nickname != "Bob" {
		t.Fatalf("unexpected first top user: %+v", userTop[0])
	}
	if userTop[1].UserID != userOne.String() || userTop[1].Points != 20 || userTop[1].Records != 2 {
		t.Fatalf("unexpected second top user: %+v", userTop[1])
	}

	recent := h.recentPointConsumption(3)
	if len(recent) != 3 {
		t.Fatalf("recent length = %d, want 3", len(recent))
	}
	if recent[0].ID != "1002" || recent[0].Points != 8 || recent[0].Balance != 80 {
		t.Fatalf("unexpected latest consumption: %+v", recent[0])
	}

	marketModels := []model.MarketModel{
		{BaseModel: model.BaseModel{ID: 2001}, Name: "Model A", ModelKey: "model-a"},
		{BaseModel: model.BaseModel{ID: 2002}, Name: "Model B", ModelKey: "model-b"},
	}
	if err := db.Create(&marketModels).Error; err != nil {
		t.Fatalf("create market models: %v", err)
	}
	logs := []model.ModelCallLog{
		{BaseModel: model.BaseModel{ID: 3001, CreateTime: now.Add(-4 * time.Hour)}, UserID: userOne, Model: "model-a", PointCost: 10, Success: 1},
		{BaseModel: model.BaseModel{ID: 3002, CreateTime: now.Add(-3 * time.Hour)}, UserID: userOne, Model: "model-a", PointCost: 10, Success: 0},
		{BaseModel: model.BaseModel{ID: 3003, CreateTime: now.Add(-2 * time.Hour)}, UserID: userTwo, Model: "model-b", PointCost: 30, Success: 1},
		{BaseModel: model.BaseModel{ID: 3004, CreateTime: now.Add(-time.Hour)}, UserID: userTwo, Model: "free-model", PointCost: 0, Success: 1},
	}
	if err := db.Create(&logs).Error; err != nil {
		t.Fatalf("create model call logs: %v", err)
	}

	modelTop := h.topPointModels(since, 8)
	if len(modelTop) != 2 {
		t.Fatalf("top models length = %d, want 2", len(modelTop))
	}
	if modelTop[0].Model != "model-b" || modelTop[0].ModelName != "Model B" || modelTop[0].Points != 30 || modelTop[0].Calls != 1 || modelTop[0].Users != 1 || modelTop[0].Success != 1 {
		t.Fatalf("unexpected first top model: %+v", modelTop[0])
	}
	if modelTop[1].Model != "model-a" || modelTop[1].Points != 20 || modelTop[1].Calls != 2 || modelTop[1].Success != 1 {
		t.Fatalf("unexpected second top model: %+v", modelTop[1])
	}
}
