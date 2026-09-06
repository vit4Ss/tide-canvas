package admin

import (
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"

	"tidecanvas/internal/handler/points"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

// An order clawback must not consume points that a live model call already
// reserved. Overshooting leaves held_micros above the balance, which makes
// every later BalanceMicros call fail and strands the reservation forever.
func TestRefundOrderLeavesTokenReservationIntact(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+t.Name()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("get sql db: %v", err)
	}
	sqlDB.SetMaxOpenConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.User{}, &model.Order{}, &model.PointRecord{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	const uid idgen.ID = 940101
	const orderID idgen.ID = 940102
	// 10 points on the books, 8 of them reserved by an in-flight token call.
	if err := db.Create(&model.User{ID: uid, Username: "hold-user", Status: 1, Points: 10, PointHeldMicros: 8 * model.PointScale}).Error; err != nil {
		t.Fatalf("create user: %v", err)
	}
	if err := db.Create(&model.Order{BaseModel: model.BaseModel{ID: orderID}, OrderNo: "NO-940102", UserID: uid, OrderType: "point_package", Status: 1}).Error; err != nil {
		t.Fatalf("create order: %v", err)
	}
	refID := orderID
	if err := db.Create(&model.PointRecord{UserID: uid, ChangeType: "recharge", Amount: 10, Balance: 10, RefID: &refID}).Error; err != nil {
		t.Fatalf("create grant: %v", err)
	}

	gin.SetMode(gin.TestMode)
	h := &g4PaymentsHandler{db: db}
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Params = gin.Params{{Key: "id", Value: orderID.String()}}
	c.Request = httptest.NewRequest("POST", "/api/admin/payments/orders/"+orderID.String()+"/refund", nil)
	h.refundOrder(c)
	if rec.Code != 200 {
		t.Fatalf("refund failed: %d %s", rec.Code, rec.Body.String())
	}

	var user model.User
	if err := db.First(&user, "id = ?", uid).Error; err != nil {
		t.Fatalf("reload user: %v", err)
	}
	if user.PointHeldMicros != 8*model.PointScale {
		t.Fatalf("reservation must survive an order refund, held = %d", user.PointHeldMicros)
	}
	available, err := points.BalanceMicros(&user)
	if err != nil {
		t.Fatalf("account is unusable after the clawback: %v (points=%d fraction=%d held=%d)", err, user.Points, user.PointFraction, user.PointHeldMicros)
	}
	if available != 0 {
		t.Fatalf("clawback should take the 2 unreserved points only, available = %d", available)
	}

	// The reservation must still be releasable, and its settlement must be able
	// to charge the tokens actually consumed.
	if err := db.Transaction(func(tx *gorm.DB) error {
		if err := points.HoldMicros(tx, uid, -8*model.PointScale); err != nil {
			return err
		}
		return points.ChangeMicros(tx, uid, -1_500_000, points.ChangeConsume, "token settle", orderID)
	}); err != nil {
		t.Fatalf("settling the reserved call must still succeed: %v", err)
	}
	if err := db.First(&user, "id = ?", uid).Error; err != nil {
		t.Fatalf("reload user: %v", err)
	}
	if user.Points != 6 || user.PointFraction != 500_000 || user.PointHeldMicros != 0 {
		t.Fatalf("unexpected balance after settlement: points=%d fraction=%d held=%d", user.Points, user.PointFraction, user.PointHeldMicros)
	}
}
