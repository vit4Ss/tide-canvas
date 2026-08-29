//go:build cgo

package points

import (
	"errors"
	"path/filepath"
	"sync"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

func refundTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := filepath.ToSlash(filepath.Join(t.TempDir(), "points.db")) + "?_busy_timeout=10000&_journal_mode=WAL"
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{
		Logger:         logger.Default.LogMode(logger.Silent),
		TranslateError: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.User{}, &model.AiTask{}, &model.PointRecord{}, &model.PointRefundReceipt{}); err != nil {
		t.Fatal(err)
	}
	return db
}

func TestRefundConcurrentExactlyOnce(t *testing.T) {
	db := refundTestDB(t)
	userID, refID := idgen.Next(), idgen.Next()
	if err := db.Create(&model.User{ID: userID, Username: "refund-race", Points: 100}).Error; err != nil {
		t.Fatal(err)
	}

	const workers = 16
	start := make(chan struct{})
	errs := make(chan error, workers)
	var wg sync.WaitGroup
	for range workers {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			errs <- Refund(db, userID, 25, "concurrent refund", refID)
		}()
	}
	close(start)
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("concurrent Refund returned error: %v", err)
		}
	}

	var user model.User
	if err := db.Select("id", "points").First(&user, "id = ?", userID).Error; err != nil {
		t.Fatal(err)
	}
	if user.Points != 125 {
		t.Fatalf("balance = %d, want 125", user.Points)
	}
	var ledgerCount, receiptCount int64
	if err := db.Model(&model.PointRecord{}).Where("change_type = ? AND ref_id = ?", ChangeRefund, refID).Count(&ledgerCount).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.PointRefundReceipt{}).Where("ref_id = ?", refID).Count(&receiptCount).Error; err != nil {
		t.Fatal(err)
	}
	if ledgerCount != 1 || receiptCount != 1 {
		t.Fatalf("refund ledger/receipt counts = %d/%d, want 1/1", ledgerCount, receiptCount)
	}
}

func TestRefundExistingReceiptMarksAiTaskRefundedWithoutCreditingAgain(t *testing.T) {
	db := refundTestDB(t)
	userID, taskID := idgen.Next(), idgen.Next()
	if err := db.Create(&model.User{ID: userID, Username: "legacy-refund", Points: 125}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.AiTask{ID: taskID, UserID: userID, PointCost: 25, Refunded: false}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.PointRefundReceipt{RefID: taskID, UserID: userID, Amount: 25}).Error; err != nil {
		t.Fatal(err)
	}
	if err := Refund(db, userID, 25, "legacy retry", taskID); err != nil {
		t.Fatal(err)
	}

	var user model.User
	if err := db.Select("id", "points").First(&user, "id = ?", userID).Error; err != nil {
		t.Fatal(err)
	}
	if user.Points != 125 {
		t.Fatalf("balance = %d, want unchanged 125", user.Points)
	}
	var task model.AiTask
	if err := db.Unscoped().Select("id", "refunded").First(&task, "id = ?", taskID).Error; err != nil {
		t.Fatal(err)
	}
	if !task.Refunded {
		t.Fatal("existing receipt did not synchronize AiTask.refunded")
	}
}

func TestAdminRefundCreditsSettledTaskWithoutRefundEvidence(t *testing.T) {
	db := refundTestDB(t)
	userID, taskID := idgen.Next(), idgen.Next()
	if err := db.Create(&model.User{ID: userID, Username: "admin-refund-settled", Email: "admin-refund-settled@example.test", Points: 100}).Error; err != nil {
		t.Fatal(err)
	}
	// Refunded=true may mean a dispatched cancellation was settled without any
	// point credit. The absence of receipt/ledger is the authoritative signal.
	if err := db.Create(&model.AiTask{ID: taskID, UserID: userID, PointCost: 25, Refunded: true}).Error; err != nil {
		t.Fatal(err)
	}
	credited, err := AdminRefund(db, userID, 25, "administrator refund", taskID)
	if err != nil {
		t.Fatal(err)
	}
	if !credited {
		t.Fatal("administrator refund did not report a new balance credit")
	}
	var user model.User
	if err := db.Select("id", "points").First(&user, "id = ?", userID).Error; err != nil {
		t.Fatal(err)
	}
	if user.Points != 125 {
		t.Fatalf("balance = %d, want 125", user.Points)
	}
	credited, err = AdminRefund(db, userID, 25, "administrator refund retry", taskID)
	if err != nil {
		t.Fatal(err)
	}
	if credited {
		t.Fatal("idempotent administrator retry reported another credit")
	}
	if err := db.Select("id", "points").First(&user, "id = ?", userID).Error; err != nil {
		t.Fatal(err)
	}
	if user.Points != 125 {
		t.Fatalf("retry balance = %d, want unchanged 125", user.Points)
	}
}

func TestAdminRefundDoesNotDuplicateLegacyLedgerWithoutReceipt(t *testing.T) {
	db := refundTestDB(t)
	userID, taskID := idgen.Next(), idgen.Next()
	if err := db.Create(&model.User{ID: userID, Username: "admin-refund-legacy", Email: "admin-refund-legacy@example.test", Points: 125}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.AiTask{ID: taskID, UserID: userID, PointCost: 25, Refunded: true}).Error; err != nil {
		t.Fatal(err)
	}
	ref := taskID
	if err := db.Create(&model.PointRecord{UserID: userID, ChangeType: ChangeRefund, Amount: 25, Balance: 125, Remark: "legacy refund", RefID: &ref}).Error; err != nil {
		t.Fatal(err)
	}
	credited, err := AdminRefund(db, userID, 25, "administrator legacy retry", taskID)
	if err != nil {
		t.Fatal(err)
	}
	if credited {
		t.Fatal("legacy refund ledger was credited twice")
	}
	var user model.User
	if err := db.Select("id", "points").First(&user, "id = ?", userID).Error; err != nil {
		t.Fatal(err)
	}
	if user.Points != 125 {
		t.Fatalf("balance = %d, want unchanged 125", user.Points)
	}
	var receiptCount int64
	if err := db.Model(&model.PointRefundReceipt{}).Where("ref_id = ?", taskID).Count(&receiptCount).Error; err != nil {
		t.Fatal(err)
	}
	if receiptCount != 1 {
		t.Fatalf("backfilled receipt count = %d, want 1", receiptCount)
	}
}

func TestRefundRejectsMismatchedReceipt(t *testing.T) {
	db := refundTestDB(t)
	userID, refID := idgen.Next(), idgen.Next()
	if err := db.Create(&model.User{ID: userID, Username: "refund-conflict", Points: 100}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.PointRefundReceipt{RefID: refID, UserID: userID, Amount: 20}).Error; err != nil {
		t.Fatal(err)
	}
	if err := Refund(db, userID, 25, "bad retry", refID); !errors.Is(err, ErrRefundConflict) {
		t.Fatalf("Refund error = %v, want ErrRefundConflict", err)
	}
}

func TestRefundRejectsMismatchedAiTask(t *testing.T) {
	db := refundTestDB(t)
	userID, otherUserID, taskID := idgen.Next(), idgen.Next(), idgen.Next()
	if err := db.Create(&model.User{ID: userID, Username: "task-owner", Email: "task-owner@example.test", Points: 100}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.User{ID: otherUserID, Username: "wrong-refund-owner", Email: "wrong-refund-owner@example.test", Points: 50}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.AiTask{ID: taskID, UserID: userID, PointCost: 25}).Error; err != nil {
		t.Fatal(err)
	}
	if err := Refund(db, otherUserID, 25, "wrong owner", taskID); !errors.Is(err, ErrRefundConflict) {
		t.Fatalf("Refund error = %v, want ErrRefundConflict", err)
	}

	var receiptCount int64
	if err := db.Model(&model.PointRefundReceipt{}).Where("ref_id = ?", taskID).Count(&receiptCount).Error; err != nil {
		t.Fatal(err)
	}
	if receiptCount != 0 {
		t.Fatalf("rolled-back mismatched task left %d receipt(s)", receiptCount)
	}
	var other model.User
	if err := db.Select("id", "points").First(&other, "id = ?", otherUserID).Error; err != nil {
		t.Fatal(err)
	}
	if other.Points != 50 {
		t.Fatalf("wrong user balance = %d, want unchanged 50", other.Points)
	}
}
