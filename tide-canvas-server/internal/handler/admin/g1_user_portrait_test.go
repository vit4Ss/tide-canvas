package admin

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"tidecanvas/internal/middleware"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

// 画像页是纯读聚合，正确性全在口径上：积分按正负号分边、模型积分只计成功任务、
// 活跃序列按天折叠、软删行不计入。用一份小而全的账本逐项断言。
func TestAdminUserPortraitAggregates(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:user_portrait?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("get sql db: %v", err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })

	if err := db.AutoMigrate(
		&model.User{}, &model.Plan{}, &model.PointRecord{}, &model.AiGenerationLog{}, &model.AiTask{},
		&model.LoginLog{}, &model.Project{}, &model.CommunityPost{}, &model.File{}, &model.SkillRun{},
		&model.Collection{}, &model.Order{}, &model.ActivationCodeClaim{}, &model.CheckinRecord{},
		&model.PostComment{}, &model.PostLike{}, &model.UserFollow{},
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	const userID idgen.ID = 7001
	now := time.Now()
	if err := db.Create(&model.User{
		ID: userID, Username: "portrait-user", Email: "p@example.test", Nickname: "画像用户", Points: 85, Remark: "private admin note",
	}).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}

	// 积分账本：40 天前充值+签到（不进近 30 天窗口），5 天前消耗与退款（进窗口）。
	pointRows := []model.PointRecord{
		{BaseModel: model.BaseModel{ID: 1, CreateTime: now.AddDate(0, 0, -40)}, UserID: userID, ChangeType: "recharge", Amount: 100, Balance: 100},
		{BaseModel: model.BaseModel{ID: 2, CreateTime: now.AddDate(0, 0, -40)}, UserID: userID, ChangeType: "checkin", Amount: 10, Balance: 110},
		{BaseModel: model.BaseModel{ID: 3, CreateTime: now.AddDate(0, 0, -5)}, UserID: userID, ChangeType: "consume", Amount: -30, Balance: 80, Remark: "生成消耗"},
		{BaseModel: model.BaseModel{ID: 4, CreateTime: now.AddDate(0, 0, -5)}, UserID: userID, ChangeType: "refund", Amount: 5, Balance: 85, Remark: "失败退款"},
	}
	if err := db.Create(&pointRows).Error; err != nil {
		t.Fatalf("create point rows: %v", err)
	}

	// 生成日志：今天两条（不同小时）+ 40 天前一条；近 30 天活跃天数应为 1。
	genRows := []model.AiGenerationLog{
		{ID: 11, UserID: userID, CreateTime: time.Date(now.Year(), now.Month(), now.Day(), 9, 0, 0, 0, now.Location())},
		{ID: 12, UserID: userID, CreateTime: time.Date(now.Year(), now.Month(), now.Day(), 21, 0, 0, 0, now.Location())},
		{ID: 13, UserID: userID, CreateTime: now.AddDate(0, 0, -40)},
	}
	if err := db.Create(&genRows).Error; err != nil {
		t.Fatalf("create gen logs: %v", err)
	}

	// 任务：模型积分只计成功——A 模型成功 12 + 失败 8（只计 12），B 模型成功 20。
	taskRows := []model.AiTask{
		{ID: 21, UserID: userID, Handler: "text_to_image", ModelName: "模型A", Status: 1, PointCost: 12, CreateTime: now.AddDate(0, 0, -3)},
		{ID: 22, UserID: userID, Handler: "text_to_image", ModelName: "模型A", Status: 2, PointCost: 8, CreateTime: now.AddDate(0, 0, -2)},
		{ID: 23, UserID: userID, Handler: "reference_to_video", ModelName: "模型B", Status: 1, PointCost: 20, CreateTime: now.AddDate(0, 0, -1)},
	}
	if err := db.Create(&taskRows).Error; err != nil {
		t.Fatalf("create tasks: %v", err)
	}

	loginRows := []model.LoginLog{
		{BaseModel: model.BaseModel{ID: 31, CreateTime: now.Add(-2 * time.Hour)}, UserID: userID, Action: "login", Channel: "password", Success: 1, IP: "1.2.3.4"},
		{BaseModel: model.BaseModel{ID: 32, CreateTime: now.Add(-3 * time.Hour)}, UserID: userID, Action: "login", Channel: "password", Success: 1, IP: "1.2.3.4"},
		{BaseModel: model.BaseModel{ID: 33, CreateTime: now.Add(-4 * time.Hour)}, UserID: userID, Action: "login", Channel: "password", Success: 0, IP: "1.2.3.4"},
	}
	if err := db.Create(&loginRows).Error; err != nil {
		t.Fatalf("create logins: %v", err)
	}

	orders := []model.Order{
		{BaseModel: model.BaseModel{ID: 41, CreateTime: now.AddDate(0, 0, -10)}, OrderNo: "O-1", UserID: userID, OrderType: "point_package", Amount: decimal.NewFromInt(99), Status: 1},
		{BaseModel: model.BaseModel{ID: 42, CreateTime: now.AddDate(0, 0, -9)}, OrderNo: "O-2", UserID: userID, OrderType: "plan", Amount: decimal.NewFromInt(50), Status: 0},
	}
	if err := db.Create(&orders).Error; err != nil {
		t.Fatalf("create orders: %v", err)
	}
	if err := db.Create(&model.ActivationCodeClaim{
		BaseModel:        model.BaseModel{ID: 51, CreateTime: now.AddDate(0, 0, -8)},
		ActivationCodeID: 1, UserID: userID, BatchName: "内测批次", CodeHint: "AB****CD", Points: 100, Balance: 100,
	}).Error; err != nil {
		t.Fatalf("create claim: %v", err)
	}
	checkins := []model.CheckinRecord{
		{BaseModel: model.BaseModel{ID: 61, CreateTime: now.AddDate(0, 0, -2)}, UserID: userID, CheckinDate: now.AddDate(0, 0, -2).Format("2006-01-02"), Points: 5, ContinuousDays: 1},
		{BaseModel: model.BaseModel{ID: 62, CreateTime: now.AddDate(0, 0, -1)}, UserID: userID, CheckinDate: now.AddDate(0, 0, -1).Format("2006-01-02"), Points: 5, ContinuousDays: 2},
	}
	if err := db.Create(&checkins).Error; err != nil {
		t.Fatalf("create checkins: %v", err)
	}

	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Params = gin.Params{{Key: "id", Value: userID.String()}}
	c.Request = httptest.NewRequest("GET", "/admin/users/7001/portrait", nil)
	(&userHandler{db: db}).userPortrait(c)

	var envelope struct {
		Success bool           `json:"success"`
		Code    int            `json:"code"`
		Data    UserPortraitVO `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("decode response: %v (%s)", err, w.Body.String())
	}
	if !envelope.Success {
		t.Fatalf("success=false, code=%d, body=%s", envelope.Code, w.Body.String())
	}
	got := envelope.Data

	if got.User.ID != userID || got.User.Nickname != "画像用户" {
		t.Fatalf("user section = %+v", got.User)
	}
	p := got.Points
	if p.Balance != 85 || p.TotalEarned != 115 || p.TotalSpent != 30 || p.Earned30 != 5 || p.Spent30 != 30 || p.RefundCount != 1 {
		t.Fatalf("points = %+v", p)
	}
	if len(p.ByType) != 4 || len(p.Transactions) != 4 {
		t.Fatalf("points detail sizes: byType=%d tx=%d", len(p.ByType), len(p.Transactions))
	}

	a := got.Activity
	if len(a.Daily) != portraitDailyWindowDays {
		t.Fatalf("daily window = %d", len(a.Daily))
	}
	today := now.Format("2006-01-02")
	if last := a.Daily[len(a.Daily)-1]; last.Date != today || last.Count != 2 {
		t.Fatalf("today bucket = %+v", last)
	}
	if a.ActiveDays30 != 1 || a.LoginDays30 != 1 {
		t.Fatalf("active=%d loginDays=%d", a.ActiveDays30, a.LoginDays30)
	}
	if a.Hourly[9] < 1 || a.Hourly[21] < 1 {
		t.Fatalf("hourly = %v", a.Hourly)
	}
	if len(a.RecentLogins) != 3 {
		t.Fatalf("recent logins = %d", len(a.RecentLogins))
	}

	g := got.Generation
	if g.Total != 3 || g.Success != 2 || g.Failed != 1 || g.Total30 != 3 || g.Failed30 != 1 {
		t.Fatalf("generation = %+v", g)
	}
	if len(g.ByHandler) != 2 || g.ByHandler[0].Key != "text_to_image" || g.ByHandler[0].Count != 2 || g.ByHandler[0].Points != 12 {
		t.Fatalf("byHandler = %+v", g.ByHandler)
	}

	if len(got.Models) != 2 {
		t.Fatalf("models = %+v", got.Models)
	}
	if got.Models[0].Model != "模型A" || got.Models[0].Count != 2 || got.Models[0].Success != 1 || got.Models[0].Points != 12 {
		t.Fatalf("model rank head = %+v", got.Models[0])
	}
	if got.Models[1].Model != "模型B" || got.Models[1].Points != 20 {
		t.Fatalf("model rank second = %+v", got.Models[1])
	}

	cm := got.Commerce
	if cm.PaidOrderCount != 1 || cm.PaidAmount == "" || cm.PaidAmount[0] != '9' {
		t.Fatalf("commerce paid = %+v", cm)
	}
	if len(cm.RecentOrders) != 2 || cm.ClaimCount != 1 || cm.ClaimPoints != 100 {
		t.Fatalf("commerce detail = %+v", cm)
	}
	if cm.CheckinCount != 2 || cm.CheckinPoints != 10 || cm.CheckinStreak != 2 || cm.LastCheckin == "" {
		t.Fatalf("checkin = %+v", cm)
	}

	// The caller-scoped route reuses the aggregate but must not expose the
	// admin-only remark or login IPs to the front-end account surface.
	selfRecorder := httptest.NewRecorder()
	selfCtx, _ := gin.CreateTestContext(selfRecorder)
	selfCtx.Set(middleware.CtxUserID, userID)
	selfCtx.Request = httptest.NewRequest("GET", "/me/portrait", nil)
	(&userHandler{db: db}).currentUserPortrait(selfCtx)
	var selfEnvelope struct {
		Success bool           `json:"success"`
		Data    UserPortraitVO `json:"data"`
	}
	if err := json.Unmarshal(selfRecorder.Body.Bytes(), &selfEnvelope); err != nil {
		t.Fatalf("decode self portrait response: %v (%s)", err, selfRecorder.Body.String())
	}
	if !selfEnvelope.Success || selfEnvelope.Data.User.ID != userID || selfEnvelope.Data.User.Remark != "" {
		t.Fatalf("self portrait identity leaked or missing: %+v", selfEnvelope.Data.User)
	}
	for _, login := range selfEnvelope.Data.Activity.RecentLogins {
		if login.IP != "" {
			t.Fatalf("self portrait exposed login IP: %+v", login)
		}
	}
}
