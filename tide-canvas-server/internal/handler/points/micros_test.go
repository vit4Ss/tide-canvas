//go:build cgo

package points

import (
	"encoding/json"
	"errors"
	"testing"

	"gorm.io/gorm"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

func TestFractionalTokenHoldsCannotBeSpentByLegacyCalls(t *testing.T) {
	db := refundTestDB(t)
	user := model.User{ID: idgen.Next(), Username: "token-wallet", Status: 1, Points: 10}
	if err := db.Create(&user).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Transaction(func(tx *gorm.DB) error { return HoldMicros(tx, user.ID, 1_200_000) }); err != nil {
		t.Fatal(err)
	}
	if err := Consume(db, user.ID, 9, "too much", idgen.Next()); !errors.Is(err, ErrInsufficient) {
		t.Fatalf("reserved points spent: %v", err)
	}
	if err := Consume(db, user.ID, 8, "legacy call", idgen.Next()); err != nil {
		t.Fatal(err)
	}
	if err := db.Transaction(func(tx *gorm.DB) error {
		if err := HoldMicros(tx, user.ID, -1_200_000); err != nil {
			return err
		}
		return ChangeMicros(tx, user.ID, -300_000, "consume", "token call", idgen.Next())
	}); err != nil {
		t.Fatal(err)
	}
	db.First(&user, "id = ?", user.ID)
	if user.Points != 1 || user.PointFraction != 700_000 || user.PointHeldMicros != 0 || user.PointBalance() != 1.7 {
		t.Fatalf("bad fractional wallet: %+v", user)
	}
	var ledger []model.PointRecord
	db.Order("id").Find(&ledger)
	if len(ledger) != 2 || ledger[0].ExactAmount() != -8 || ledger[1].ExactAmount() != -.3 || ledger[1].ExactBalance() != 1.7 {
		t.Fatal("ledger does not reconcile")
	}
}

func TestOneMicroPointBoundaryAndAdminClamp(t *testing.T) {
	db := refundTestDB(t)
	user := model.User{ID: idgen.Next(), Username: "micro-wallet", Status: 1, Points: 1}
	db.Create(&user)
	if err := db.Transaction(func(tx *gorm.DB) error { return HoldMicros(tx, user.ID, 999_999) }); err != nil {
		t.Fatal(err)
	}
	if err := Consume(db, user.ID, 1, "overspend", idgen.Next()); !errors.Is(err, ErrInsufficient) {
		t.Fatal("fractional guard rounded up")
	}
	var record *model.PointRecord
	if err := db.Transaction(func(tx *gorm.DB) error {
		var err error
		record, err = AdjustWhole(tx, user.ID, -100, "adjust", "admin adjustment", 0)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if record.ExactAmount() != -.000001 {
		t.Fatalf("adjustment touched held funds: %v", record.ExactAmount())
	}
	db.First(&user, "id = ?", user.ID)
	if user.PointBalance() != 0 || user.PointHeldMicros != 999_999 {
		t.Fatal("hold invariant lost")
	}
	value, _ := json.Marshal((&model.User{Points: 1, PointHeldMicros: 900_000}).PointBalance())
	if string(value) != "0.1" {
		t.Fatalf("balance exposes floating-point artifact: %s", value)
	}
}
