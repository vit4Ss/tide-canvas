//go:build cgo

package points

import (
	"errors"
	"path/filepath"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/activationcode"
	"tidecanvas/internal/pkg/idgen"
)

func activationCodeTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := filepath.ToSlash(filepath.Join(t.TempDir(), "activation-code.db")) + "?_busy_timeout=10000&_journal_mode=WAL"
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent), TranslateError: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.User{}, &model.PointRecord{}, &model.ActivationCode{}, &model.ActivationCodeClaim{}); err != nil {
		t.Fatal(err)
	}
	return db
}

func createActivationCode(t *testing.T, db *gorm.DB, plain string, status, limit, points int, expires time.Time) model.ActivationCode {
	t.Helper()
	hash, err := activationcode.Hash(plain)
	if err != nil {
		t.Fatal(err)
	}
	hint, _ := activationcode.Hint(plain)
	row := model.ActivationCode{
		CodeHash: hash, CodeHint: hint, BatchName: "test batch", Status: status,
		UsageLimit: limit, Points: points, ExpiresAt: expires, CreatedBy: idgen.Next(),
	}
	if err := db.Create(&row).Error; err != nil {
		t.Fatal(err)
	}
	if status == 0 {
		if err := db.Model(&row).Update("status", 0).Error; err != nil {
			t.Fatal(err)
		}
		row.Status = 0
	}
	return row
}

func TestRedeemActivationCodeCreditsAndAuditsExactlyOnce(t *testing.T) {
	db := activationCodeTestDB(t)
	repo := newRepo(db)
	userID := idgen.Next()
	if err := db.Create(&model.User{ID: userID, Username: "redeemer", Points: 40}).Error; err != nil {
		t.Fatal(err)
	}
	plain := "FLOW-2345-6789-ABCD"
	code := createActivationCode(t, db, plain, 1, 2, 75, time.Now().Add(time.Hour))
	hash, _ := activationcode.Hash(plain)

	claim, balance, err := repo.redeemActivationCode(userID, hash, "127.0.0.1", "test-agent", time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if balance != 115 || claim.Points != 75 || claim.Balance != 115 {
		t.Fatalf("balance/claim = %d/%+v", balance, claim)
	}
	var storedCode model.ActivationCode
	if err := db.First(&storedCode, "id = ?", code.ID).Error; err != nil {
		t.Fatal(err)
	}
	if storedCode.UsedCount != 1 || storedCode.CodeHash == plain || storedCode.LastUsedAt == nil {
		t.Fatalf("stored code = %+v", storedCode)
	}
	var ledger model.PointRecord
	if err := db.Where("user_id = ?", userID).First(&ledger).Error; err != nil {
		t.Fatal(err)
	}
	if ledger.ChangeType != changeTypeActivationCode || ledger.Amount != 75 || ledger.Balance != 115 || ledger.RefID == nil || *ledger.RefID != claim.ID {
		t.Fatalf("ledger = %+v", ledger)
	}

	if _, _, err := repo.redeemActivationCode(userID, hash, "127.0.0.1", "test-agent", time.Now()); !errors.Is(err, ErrActivationCodeClaimed) {
		t.Fatalf("duplicate redeem error = %v", err)
	}
	var user model.User
	if err := db.Select("id", "points").First(&user, "id = ?", userID).Error; err != nil {
		t.Fatal(err)
	}
	if user.Points != 115 {
		t.Fatalf("duplicate changed balance to %d", user.Points)
	}
}

func TestRedeemActivationCodeRejectsExhaustedExpiredAndDisabled(t *testing.T) {
	db := activationCodeTestDB(t)
	repo := newRepo(db)
	user1, user2 := idgen.Next(), idgen.Next()
	if err := db.Create(&[]model.User{
		{ID: user1, Username: "user-one", Email: "user-one@example.test"},
		{ID: user2, Username: "user-two", Email: "user-two@example.test"},
	}).Error; err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	active := "FLOW-AAAA-BBBB-CCCC"
	createActivationCode(t, db, active, 1, 1, 10, now.Add(time.Hour))
	activeHash, _ := activationcode.Hash(active)
	if _, _, err := repo.redeemActivationCode(user1, activeHash, "", "", now); err != nil {
		t.Fatal(err)
	}
	if _, _, err := repo.redeemActivationCode(user2, activeHash, "", "", now); !errors.Is(err, ErrActivationCodeExhausted) {
		t.Fatalf("exhausted error = %v", err)
	}

	disabled := "FLOW-DDDD-EEEE-FFFF"
	createActivationCode(t, db, disabled, 0, 1, 10, now.Add(time.Hour))
	disabledHash, _ := activationcode.Hash(disabled)
	if _, _, err := repo.redeemActivationCode(user2, disabledHash, "", "", now); !errors.Is(err, ErrActivationCodeDisabled) {
		t.Fatalf("disabled error = %v", err)
	}

	expired := "FLOW-GGGG-HHHH-JJJJ"
	createActivationCode(t, db, expired, 1, 1, 10, now.Add(-time.Hour))
	expiredHash, _ := activationcode.Hash(expired)
	if _, _, err := repo.redeemActivationCode(user2, expiredHash, "", "", now); !errors.Is(err, ErrActivationCodeExpired) {
		t.Fatalf("expired error = %v", err)
	}
}
