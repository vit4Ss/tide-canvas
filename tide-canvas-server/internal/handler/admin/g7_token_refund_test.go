package admin

import (
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"tidecanvas/internal/app"
	"tidecanvas/internal/handler/points"
	"tidecanvas/internal/middleware"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

func TestGenerationRefundUsesFractionalTokenFeeNotSharedIntegerDebit(t *testing.T) {
	gin.SetMode(gin.TestMode)
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	pool, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	pool.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = pool.Close() })
	if err := db.AutoMigrate(&model.User{}, &model.AiTask{}, &model.AiGenerationLog{}, &model.ModelCallLog{}, &model.PointRecord{}, &model.PointRefundReceipt{}, &model.ModelGatewayRequest{}); err != nil {
		t.Fatal(err)
	}
	uid, adminID := idgen.Next(), idgen.Next()
	for _, user := range []model.User{
		{ID: uid, Username: "payer", Email: "payer@example.test", Points: 20, Status: 1},
		{ID: adminID, Username: "admin", Email: "admin@example.test", Role: middleware.AdminRole, Status: 1},
	} {
		if err := db.Create(&user).Error; err != nil {
			t.Fatal(err)
		}
	}
	logs := []model.ModelCallLog{}
	for _, key := range []string{"a", "b"} {
		bill := model.ModelGatewayRequest{BaseModel: model.BaseModel{ID: idgen.Next()}, UserID: uid, RequestKey: key, SettlementMode: model.ChatSettlementAccumulated, CostMicros: 600000, Status: "success"}
		if err := db.Transaction(func(tx *gorm.DB) error {
			debit, pending, err := points.AccrueChatCost(tx, uid, bill.CostMicros, "call", bill.ID)
			if err != nil {
				return err
			}
			bill.WalletDebitMicros, bill.PendingAfterMicros = debit, pending
			return tx.Create(&bill).Error
		}); err != nil {
			t.Fatal(err)
		}
		row := model.ModelCallLog{BaseModel: model.BaseModel{ID: idgen.Next()}, UserID: uid, Scene: "chat", Model: "test", Success: 1, PointCost: bill.WalletDebitMicros / model.PointScale, Endpoint: "/api/integrations/v1/responses", BillingRefID: bill.ID, BillingRefType: "ledger"}
		if err := db.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
		logs = append(logs, row)
	}
	// Reverse the call with no original integer debit first. Only its own .6 fee
	// may be refunded, even though the later call posted a shared whole point.
	for i, row := range logs {
		for replay := 0; replay < 2; replay++ {
			w := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(w)
			c.Set(middleware.CtxUserID, adminID)
			c.Set(middleware.CtxRole, middleware.AdminRole)
			c.Params = gin.Params{{Key: "id", Value: row.ID.String()}}
			refundGeneration(c, &app.Deps{DB: db})
			if w.Code != 200 {
				t.Fatalf("refund %d replay %d: %d %s", i, replay, w.Code, w.Body.String())
			}
			var response struct {
				Data GenerationDetailVO `json:"data"`
			}
			if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
				t.Fatal(err)
			}
			if !response.Data.Refunded || !response.Data.TokenAccrued || response.Data.PointCost == nil || *response.Data.PointCost != .6 {
				t.Fatalf("wrong refund detail: %s", w.Body.String())
			}
		}
		var user model.User
		if err := db.First(&user, "id = ?", uid).Error; err != nil {
			t.Fatal(err)
		}
		wantPending := int64(600000)
		if i == 1 {
			wantPending = 0
		}
		if user.Points != 20 || user.ChatPendingMicros != wantPending {
			t.Fatalf("wrong balance after refund %d: %d/%d", i, user.Points, user.ChatPendingMicros)
		}
	}
	var count int64
	if err := db.Model(&model.PointRecord{}).Where("change_type = ?", points.ChangeRefund).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("refund ledger duplicated: %d", count)
	}
}
