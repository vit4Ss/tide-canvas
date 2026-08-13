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

	if err := db.AutoMigrate(&model.User{}, &model.PointRecord{}, &model.PointRefundReceipt{}, &model.ModelCallLog{}, &model.MarketModel{}); err != nil {
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
	refundedRef, currentRef, yesterdayRef, legacyRefundedRef := idgen.ID(9001), idgen.ID(9002), idgen.ID(9003), idgen.ID(9004)
	records := []model.PointRecord{
		{BaseModel: model.BaseModel{ID: 1001, CreateTime: now.AddDate(0, 0, -2)}, UserID: userOne, ChangeType: "consume", Amount: -12, Balance: 88, Remark: "image", RefID: &refundedRef},
		{BaseModel: model.BaseModel{ID: 1002, CreateTime: now.Add(-time.Hour)}, UserID: userOne, ChangeType: "consume", Amount: -8, Balance: 80, Remark: "chat", RefID: &currentRef},
		{BaseModel: model.BaseModel{ID: 1003, CreateTime: now.AddDate(0, 0, -1)}, UserID: userTwo, ChangeType: "consume", Amount: -30, Balance: 70, Remark: "video", RefID: &yesterdayRef},
		// A later refund removes the failed call from its original consumption day.
		{BaseModel: model.BaseModel{ID: 1004, CreateTime: now.Add(-30 * time.Minute)}, UserID: userOne, ChangeType: "refund", Amount: 12, Balance: 92, Remark: "refund", RefID: &refundedRef},
		// A rolling-deploy legacy refund may have its ledger row but no receipt yet.
		{BaseModel: model.BaseModel{ID: 1007, CreateTime: now.Add(-40 * time.Minute)}, UserID: userOne, ChangeType: "consume", Amount: -7, Balance: 85, Remark: "legacy image", RefID: &legacyRefundedRef},
		{BaseModel: model.BaseModel{ID: 1008, CreateTime: now.Add(-20 * time.Minute)}, UserID: userOne, ChangeType: "refund", Amount: 7, Balance: 92, Remark: "legacy refund", RefID: &legacyRefundedRef},
		// Rows outside the reporting window and soft-deleted rows are excluded.
		{BaseModel: model.BaseModel{ID: 1005, CreateTime: since.Add(-time.Hour)}, UserID: userOne, ChangeType: "consume", Amount: -50, Balance: 38, Remark: "old"},
		{BaseModel: model.BaseModel{ID: 1006, CreateTime: now.Add(-2 * time.Hour), Deleted: deletedAt}, UserID: userTwo, ChangeType: "consume", Amount: -100, Balance: 0, Remark: "deleted"},
	}
	if err := db.Create(&records).Error; err != nil {
		t.Fatalf("create point records: %v", err)
	}
	if err := db.Create(&model.PointRefundReceipt{RefID: refundedRef, UserID: userOne, Amount: 12, CreateTime: now.Add(-30 * time.Minute)}).Error; err != nil {
		t.Fatalf("create refund receipt: %v", err)
	}

	h := &dashboardHandler{db: db}
	summary := h.pointSummary(since, today)
	if summary.TodayPoints != 8 || summary.PeriodPoints != 38 || summary.PeriodUsers != 2 || summary.PeriodRecords != 2 {
		t.Fatalf("unexpected point summary: %+v", summary)
	}

	userTop := h.topPointUsers(since, 8)
	if len(userTop) != 2 {
		t.Fatalf("top users length = %d, want 2", len(userTop))
	}
	if userTop[0].UserID != userTwo.String() || userTop[0].Points != 30 || userTop[0].Records != 1 || userTop[0].Nickname != "Bob" {
		t.Fatalf("unexpected first top user: %+v", userTop[0])
	}
	if userTop[1].UserID != userOne.String() || userTop[1].Points != 8 || userTop[1].Records != 1 {
		t.Fatalf("unexpected second top user: %+v", userTop[1])
	}

	// 今日口径（窗口起点 = 当天零点）复用同一实现：昨日/删除/退款行都不入。
	todayUserTop := h.topPointUsers(today, 8)
	if len(todayUserTop) != 1 || todayUserTop[0].UserID != userOne.String() || todayUserTop[0].Points != 8 {
		t.Fatalf("unexpected today top users: %+v", todayUserTop)
	}

	recent := h.recentPointConsumption(3)
	if len(recent) != 3 {
		t.Fatalf("recent length = %d, want 3", len(recent))
	}
	if recent[0].ID != "1002" || recent[0].Points != 8 || recent[0].Balance != 80 {
		t.Fatalf("unexpected latest consumption: %+v", recent[0])
	}
	for _, row := range recent {
		if row.ID == "1001" || row.ID == "1007" {
			t.Fatalf("refunded consumption appeared in recent rows: %+v", recent)
		}
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
		{BaseModel: model.BaseModel{ID: 3005, CreateTime: now.Add(-time.Hour)}, UserID: userTwo, Model: "failed-only-model", PointCost: 40, Success: 0},
		// Legacy generic mirror of the skill row: empty text-scene payload and the
		// same point cost must not inflate calls or model consumption.
		{BaseModel: model.BaseModel{ID: 3006, CreateTime: now.Add(-2 * time.Hour)}, UserID: userOne, Scene: "text", Model: "model-a", PointCost: 10, Success: 1},
		// A real future text-scene call with call metadata must remain visible.
		{BaseModel: model.BaseModel{ID: 3007, CreateTime: now.Add(-time.Hour)}, UserID: userTwo, Scene: "text", Model: "real-text", Endpoint: "/v1/chat/completions", RequestBody: `{}`, PointCost: 0, Success: 1},
	}
	if err := db.Create(&logs).Error; err != nil {
		t.Fatalf("create model call logs: %v", err)
	}
	// Some legacy rows have a NULL scene. The duplicate filter must retain them
	// instead of letting SQL's three-valued NOT(NULL) drop a real call.
	if err := db.Exec("UPDATE model_call_log SET scene = NULL WHERE id = ?", 3001).Error; err != nil {
		t.Fatalf("set legacy null scene: %v", err)
	}

	modelTop := h.topPointModels(since, 8)
	if len(modelTop) != 2 {
		t.Fatalf("top models length = %d, want 2", len(modelTop))
	}
	if modelTop[0].Model != "model-b" || modelTop[0].ModelName != "Model B" || modelTop[0].Points != 30 || modelTop[0].Calls != 1 || modelTop[0].Users != 1 || modelTop[0].Success != 1 {
		t.Fatalf("unexpected first top model: %+v", modelTop[0])
	}
	if modelTop[1].Model != "model-a" || modelTop[1].Points != 10 || modelTop[1].Calls != 2 || modelTop[1].Success != 1 {
		t.Fatalf("unexpected second top model: %+v", modelTop[1])
	}
	callTop := h.topModelCalls(since, 8)
	foundModelA, foundRealText := false, false
	for _, row := range callTop {
		switch row.Model {
		case "model-a":
			foundModelA = true
			if row.Count != 2 {
				t.Fatalf("legacy mirror inflated model call count: %+v", row)
			}
		case "real-text":
			foundRealText = true
			if row.Count != 1 {
				t.Fatalf("real text call count = %d, want 1", row.Count)
			}
		}
	}
	if !foundModelA || !foundRealText {
		t.Fatalf("model call rows missing: %+v", callTop)
	}

	// 今日口径的模型排行：本用例的调用日志都发生在今天，应与 14 天窗口一致。
	todayModelTop := h.topPointModels(today, 8)
	if len(todayModelTop) != 2 || todayModelTop[0].Points != 30 || todayModelTop[1].Points != 10 {
		t.Fatalf("unexpected today top models: %+v", todayModelTop)
	}
}
