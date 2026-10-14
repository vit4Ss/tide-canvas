package points

import (
	"errors"
	"math/rand"
	"sync"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

func accrualDB(t *testing.T, balance int64) (*gorm.DB, idgen.ID) {
	t.Helper()
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
	if err := db.AutoMigrate(&model.User{}, &model.PointRecord{}, &model.PointRefundReceipt{}, &model.AiTask{}, &model.ModelGatewayRequest{}); err != nil {
		t.Fatal(err)
	}
	uid := idgen.Next()
	if err := db.Create(&model.User{ID: uid, Username: "accrual-user", Email: "accrual@example.test", Points: balance}).Error; err != nil {
		t.Fatal(err)
	}
	return db, uid
}

func TestChatAccrualPostsOnlyWholePointsAndKeepsAvailableFundsExact(t *testing.T) {
	db, uid := accrualDB(t, 20)
	for i, want := range []struct {
		debit, pending, posted int64
		available              float64
	}{{0, 600000, 20, 19.4}, {1000000, 200000, 19, 18.8}} {
		err := db.Transaction(func(tx *gorm.DB) error {
			debit, pending, err := AccrueChatCost(tx, uid, 600000, "token accrual", idgen.Next())
			if err == nil && (debit != want.debit || pending != want.pending) {
				t.Fatalf("call %d: debit=%d pending=%d", i, debit, pending)
			}
			return err
		})
		if err != nil {
			t.Fatal(err)
		}
		var user model.User
		if err := db.First(&user, "id = ?", uid).Error; err != nil {
			t.Fatal(err)
		}
		if user.Points != want.posted || user.PointFraction != 0 || user.ChatPendingMicros != want.pending || user.PointBalance() != want.available {
			t.Fatalf("call %d: posted=%d pending=%d available=%v", i, user.Points, user.ChatPendingMicros, user.PointBalance())
		}
	}
	var ledger []model.PointRecord
	if err := db.Find(&ledger).Error; err != nil {
		t.Fatal(err)
	}
	if len(ledger) != 1 || ledger[0].ExactAmount() != -1 || ledger[0].ExactBalance() != 19 {
		t.Fatalf("wrong whole-point ledger: %+v", ledger)
	}
	if err := Consume(db, uid, 19, "cannot spend pending fees", 0); !errors.Is(err, ErrInsufficient) {
		t.Fatalf("spent accrued fees: %v", err)
	}
	if err := db.Transaction(func(tx *gorm.DB) error { return HoldMicros(tx, uid, 19*model.PointScale) }); !errors.Is(err, ErrInsufficient) {
		t.Fatalf("reserved accrued fees again: %v", err)
	}
	if err := Consume(db, uid, 18, "generation", 0); err != nil {
		t.Fatal(err)
	}
	if err := Refund(db, uid, 18, "generation refund", 0); err != nil {
		t.Fatal(err)
	}
	var user model.User
	db.First(&user, "id = ?", uid)
	if user.Points != 19 || user.ChatPendingMicros != 200000 || user.PointBalance() != 18.8 {
		t.Fatal("generation/refund altered the chat remainder")
	}
	view, err := newService(db, nil).balance(uid)
	if err != nil || view.PostedPoints != 19 || view.Points != 18.8 || view.PendingTokenPoints != .2 {
		t.Fatalf("balance view: %+v %v", view, err)
	}
	summary, err := newService(db, nil).accountSummary(uid)
	if err != nil || summary.Total != 19 || summary.Available != 18.8 || summary.PendingTokenPoints != .2 {
		t.Fatalf("account summary: %+v %v", summary, err)
	}
}

func TestChatAccrualRollbackAndConcurrentTransactions(t *testing.T) {
	db, uid := accrualDB(t, 20)
	failed := errors.New("bill update failed")
	err := db.Transaction(func(tx *gorm.DB) error {
		if _, _, err := AccrueChatCost(tx, uid, 1600000, "rollback", 0); err != nil {
			return err
		}
		return failed
	})
	if !errors.Is(err, failed) {
		t.Fatal(err)
	}
	var user model.User
	db.First(&user, "id = ?", uid)
	var count int64
	db.Model(&model.PointRecord{}).Count(&count)
	if user.Points != 20 || user.ChatPendingMicros != 0 || count != 0 {
		t.Fatal("failed settlement left partial wallet changes")
	}
	var wg sync.WaitGroup
	errorsOut := make(chan error, 10)
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			errorsOut <- db.Transaction(func(tx *gorm.DB) error {
				_, _, err := AccrueChatCost(tx, uid, 600000, "concurrent", idgen.Next())
				return err
			})
		}()
	}
	wg.Wait()
	close(errorsOut)
	for err := range errorsOut {
		if err != nil {
			t.Fatal(err)
		}
	}
	db.First(&user, "id = ?", uid)
	var ledger []model.PointRecord
	db.Find(&ledger)
	var debited float64
	for _, row := range ledger {
		debited -= row.ExactAmount()
	}
	if user.Points != 14 || user.ChatPendingMicros != 0 || debited != 6 {
		t.Fatalf("concurrent carry lost or duplicated: posted=%d carry=%d debit=%v", user.Points, user.ChatPendingMicros, debited)
	}
}

func TestChatAccrualCanSettleAtTheLastWholePoint(t *testing.T) {
	db, uid := accrualDB(t, 1)
	if err := db.Model(&model.User{}).Where("id = ?", uid).Update("chat_pending_micros", 800000).Error; err != nil {
		t.Fatal(err)
	}
	err := db.Transaction(func(tx *gorm.DB) error {
		debit, carry, err := AccrueChatCost(tx, uid, 200000, "crossing one", 0)
		if err == nil && (debit != 1000000 || carry != 0) {
			t.Fatal("pending portion was charged twice")
		}
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	var user model.User
	db.First(&user, "id = ?", uid)
	if user.Points != 0 || user.ChatPendingMicros != 0 || user.PointFraction != 0 {
		t.Fatal("last-point settlement was not exact")
	}
}

func TestChatAccrualIsAccountScoped(t *testing.T) {
	db, uid := accrualDB(t, 20)
	other := model.User{ID: idgen.Next(), Username: "another", Email: "another@example.test", Points: 20}
	if err := db.Create(&other).Error; err != nil {
		t.Fatal(err)
	}
	for _, userID := range []idgen.ID{uid, other.ID} {
		if err := db.Transaction(func(tx *gorm.DB) error {
			_, _, err := AccrueChatCost(tx, userID, 600000, "independent fee", 0)
			return err
		}); err != nil {
			t.Fatal(err)
		}
	}
	var count int64
	db.Model(&model.PointRecord{}).Count(&count)
	if count != 0 {
		t.Fatal("fees from separate accounts were pooled")
	}
	if err := db.Transaction(func(tx *gorm.DB) error {
		_, _, err := AccrueChatCost(tx, uid, 400000, "same account later", 0)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	db.First(&other, "id = ?", other.ID)
	if other.Points != 20 || other.ChatPendingMicros != 600000 {
		t.Fatal("another account's carry changed")
	}
}

func TestAccruedRefundReversesOnlyItsOwnFeeAndPreservesHolds(t *testing.T) {
	db, uid := accrualDB(t, 20)
	bills := []model.ModelGatewayRequest{
		{BaseModel: model.BaseModel{ID: idgen.Next()}, UserID: uid, RequestKey: "first", SettlementMode: model.ChatSettlementAccumulated, Status: "success", CostMicros: 600000},
		{BaseModel: model.BaseModel{ID: idgen.Next()}, UserID: uid, RequestKey: "second", SettlementMode: model.ChatSettlementAccumulated, Status: "success", CostMicros: 600000},
	}
	for i := range bills {
		if err := db.Transaction(func(tx *gorm.DB) error {
			debit, pending, err := AccrueChatCost(tx, uid, bills[i].CostMicros, "call", bills[i].ID)
			if err != nil {
				return err
			}
			bills[i].WalletDebitMicros, bills[i].PendingAfterMicros = debit, pending
			return tx.Create(&bills[i]).Error
		}); err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Transaction(func(tx *gorm.DB) error { return HoldMicros(tx, uid, 2000000) }); err != nil {
		t.Fatal(err)
	}
	assertState := func(posted, pending, refundCount int64, available float64) {
		t.Helper()
		var user model.User
		if err := db.First(&user, "id = ?", uid).Error; err != nil {
			t.Fatal(err)
		}
		var count int64
		if err := db.Model(&model.PointRecord{}).Where("change_type = ?", ChangeRefund).Count(&count).Error; err != nil {
			t.Fatal(err)
		}
		if user.Points != posted || user.ChatPendingMicros != pending || user.PointHeldMicros != 2000000 || user.PointBalance() != available || count != refundCount {
			t.Fatalf("posted=%d pending=%d held=%d available=%v refund entries=%d", user.Points, user.ChatPendingMicros, user.PointHeldMicros, user.PointBalance(), count)
		}
	}
	// A later failure must roll back both the integer credit and the refund fence.
	failed := errors.New("refund record update failed")
	err := db.Transaction(func(tx *gorm.DB) error {
		if _, _, err := RefundAccruedChatBill(tx, uid, bills[0].ID, "rollback"); err != nil {
			return err
		}
		return failed
	})
	if !errors.Is(err, failed) {
		t.Fatal(err)
	}
	assertState(19, 200000, 0, 16.8)
	for i := range bills {
		for replay := 0; replay < 2; replay++ {
			if err := db.Transaction(func(tx *gorm.DB) error {
				refunded, cash, err := RefundAccruedChatBill(tx, uid, bills[i].ID, "refund selected call")
				if err != nil {
					return err
				}
				wantCash := int64(0)
				if i == 0 && replay == 0 {
					wantCash = model.PointScale
				}
				if refunded != (replay == 0) || cash != wantCash {
					t.Fatalf("refund %d replay %d: refunded=%v cash=%d", i, replay, refunded, cash)
				}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
		}
		if i == 0 {
			assertState(20, 600000, 1, 17.4)
		} else {
			assertState(20, 0, 1, 18)
		}
		var bill model.ModelGatewayRequest
		if err := db.First(&bill, "id = ?", bills[i].ID).Error; err != nil {
			t.Fatal(err)
		}
		wantCash := int64(0)
		if i == 0 {
			wantCash = model.PointScale
		}
		if bill.CostMicros != 600000 || bill.RefundedCostMicros != 600000 || bill.WalletRefundMicros != wantCash {
			t.Fatalf("wrong bill refund snapshot: %+v", bill)
		}
	}
}

func TestMixedAccrualAndRefundsConserveEveryMicroPoint(t *testing.T) {
	db, uid := accrualDB(t, 1000)
	const fraction, held int64 = 123456, 2345678
	if err := db.Model(&model.User{}).Where("id = ?", uid).Updates(map[string]any{"point_fraction": fraction, "point_held_micros": held}).Error; err != nil {
		t.Fatal(err)
	}
	random := rand.New(rand.NewSource(42))
	var bills []model.ModelGatewayRequest
	refunded := map[idgen.ID]bool{}
	var net int64
	check := func() {
		t.Helper()
		var user model.User
		if err := db.First(&user, "id = ?", uid).Error; err != nil {
			t.Fatal(err)
		}
		available, err := BalanceMicros(&user)
		if err != nil {
			t.Fatal(err)
		}
		if user.Points != 1000-net/model.PointScale || user.PointFraction != fraction || user.ChatPendingMicros != net%model.PointScale || user.PointHeldMicros != held || available != 1000*model.PointScale+fraction-held-net {
			t.Fatalf("wallet does not conserve fees: net=%d posted=%d fraction=%d pending=%d held=%d available=%d", net, user.Points, user.PointFraction, user.ChatPendingMicros, user.PointHeldMicros, available)
		}
	}
	refund := func(index int) {
		t.Helper()
		bill := bills[index]
		if bill.CostMicros == 0 {
			return
		}
		if err := db.Transaction(func(tx *gorm.DB) error {
			changed, _, err := RefundAccruedChatBill(tx, uid, bill.ID, "mixed-order refund")
			if err != nil {
				return err
			}
			if changed == refunded[bill.ID] {
				t.Fatalf("refund fence failed for %s", bill.ID)
			}
			return nil
		}); err != nil {
			t.Fatal(err)
		}
		if !refunded[bill.ID] {
			net -= bill.CostMicros
		}
		refunded[bill.ID] = true
		check()
	}
	boundaryFees := []int64{0, 1, 999999, 1000000, 1000001, 9999999}
	for i := 0; i < 60; i++ {
		fee := random.Int63n(3000000)
		if i < len(boundaryFees) {
			fee = boundaryFees[i]
		}
		bill := model.ModelGatewayRequest{BaseModel: model.BaseModel{ID: idgen.Next()}, UserID: uid, SettlementMode: model.ChatSettlementAccumulated, Status: "success", CostMicros: fee}
		bill.RequestKey = bill.ID.String()
		if err := db.Transaction(func(tx *gorm.DB) error {
			debit, carry, err := AccrueChatCost(tx, uid, fee, "mixed fee", bill.ID)
			if err != nil {
				return err
			}
			bill.WalletDebitMicros, bill.PendingAfterMicros = debit, carry
			return tx.Create(&bill).Error
		}); err != nil {
			t.Fatal(err)
		}
		bills = append(bills, bill)
		net += fee
		check()
		if i%3 == 2 {
			refund(random.Intn(len(bills)))
		}
	}
	for _, index := range random.Perm(len(bills)) {
		refund(index)
		refund(index)
	}
	if net != 0 {
		t.Fatalf("full refunds left fees: %d", net)
	}
	var ledger []model.PointRecord
	if err := db.Where("user_id = ?", uid).Find(&ledger).Error; err != nil {
		t.Fatal(err)
	}
	var movement int64
	for _, row := range ledger {
		if row.AmountMicros == nil || *row.AmountMicros == 0 || *row.AmountMicros%model.PointScale != 0 {
			t.Fatalf("non-integer or empty ledger entry: %+v", row)
		}
		movement += *row.AmountMicros
	}
	if movement != 0 {
		t.Fatalf("full refunds left integer debit: %d", movement)
	}
}
