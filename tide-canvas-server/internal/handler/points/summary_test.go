package points

import (
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"strings"
	"testing"
	"tidecanvas/internal/model"
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
