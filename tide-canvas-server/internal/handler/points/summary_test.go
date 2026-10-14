package points

import (
	"strings"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

func TestAccountSummaryReconcilesPreciseCreditsAndIsolatesOwners(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		if strings.Contains(err.Error(), "CGO_ENABLED=0") {
			t.Skip("SQLite requires CGO")
		}
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.User{}, &model.PointRecord{}); err != nil {
		t.Fatal(err)
	}
	micros := int64(-3125000)
	for _, row := range []any{
		&model.User{ID: 81, Username: "summary", Email: "one@example.test", Points: 100, PointFraction: 250000, PointHeldMicros: 500000},
		&model.User{ID: 82, Username: "other-summary", Email: "two@example.test", Points: 900},
		&model.PointRecord{BaseModel: model.BaseModel{ID: 811}, UserID: 81, ChangeType: "recharge", Amount: 10},
		&model.PointRecord{BaseModel: model.BaseModel{ID: 812}, UserID: 81, ChangeType: "refund", Amount: 2},
		&model.PointRecord{BaseModel: model.BaseModel{ID: 813}, UserID: 81, ChangeType: "consume", Amount: -3, AmountMicros: &micros},
		&model.PointRecord{BaseModel: model.BaseModel{ID: 814}, UserID: 82, ChangeType: "recharge", Amount: 900},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	v, err := newService(db, nil).accountSummary(81)
	if err != nil {
		t.Fatal(err)
	}
	if v.Added != 12 || v.Deducted != 3.125 || v.Refunded != 2 || v.Total != 100.25 || v.Reserved != .5 || v.Available != 99.75 || v.Opening+v.Added-v.Deducted != v.Total {
		t.Fatalf("bad summary: %+v", v)
	}
	if _, err := newService(db, nil).accountSummary(999); err != ErrNotFound {
		t.Fatalf("missing owner: %v", err)
	}
}

func TestAccountSummaryRetainsEveryMicroPoint(t *testing.T) {
	db, _ := accrualDB(t, 20)
	checkSummaryMicroPoints(t, db)
}

func checkSummaryMicroPoints(t *testing.T, db *gorm.DB) {
	t.Helper()
	uid := idgen.Next()
	debit, credit := int64(-1000001), int64(2)
	for _, row := range []any{
		&model.User{ID: uid, Username: "micro-summary-" + uid.String(), Email: uid.String() + "@example.test", Points: 20, PointFraction: 123457, PointHeldMicros: 2234567, ChatPendingMicros: 345679},
		&model.PointRecord{UserID: uid, ChangeType: ChangeConsume, Amount: -1, AmountMicros: &debit},
		&model.PointRecord{UserID: uid, ChangeType: ChangeRefund, AmountMicros: &credit},
		&model.PointRecord{UserID: uid, ChangeType: "recharge", Amount: 5},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	v, err := newService(db, nil).accountSummary(uid)
	if err != nil {
		t.Fatal(err)
	}
	if v.Added != 5.000002 || v.Deducted != 1.000001 || v.Refunded != .000002 || v.Total != 20.123457 || v.Reserved != 2.234567 || v.PendingTokenPoints != .345679 || v.Available != 17.543211 {
		t.Fatalf("summary lost micro-point precision: %+v", v)
	}
}
