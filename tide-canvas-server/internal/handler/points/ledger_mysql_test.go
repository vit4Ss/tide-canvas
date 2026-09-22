package points

import (
	"database/sql"
	"net"
	"os"
	"testing"
	"time"

	mysqldriver "github.com/go-sql-driver/mysql"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

// Opt in with a local server DSN. Only credentials are reused: each run creates
// and drops its own database, never migrating or writing the configured one.
func refundMySQLTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	raw := os.Getenv("TIDECANVAS_TEST_MYSQL_DSN")
	if raw == "" {
		t.Skip("set TIDECANVAS_TEST_MYSQL_DSN to run local MySQL isolation regression")
	}
	dsn, err := mysqldriver.ParseDSN(raw)
	if err != nil {
		t.Fatal("invalid MySQL test DSN")
	}
	host, _, err := net.SplitHostPort(dsn.Addr)
	if err != nil || dsn.Net != "tcp" || (host != "127.0.0.1" && host != "localhost" && host != "::1") {
		t.Fatal("MySQL isolation regression requires a local server")
	}
	dsn.DBName, dsn.ParseTime, dsn.Timeout = "", true, 5*time.Second
	server, err := sql.Open("mysql", dsn.FormatDSN())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = server.Close() })
	name := "refund_review_" + idgen.Next().String()
	if _, err := server.Exec("CREATE DATABASE `" + name + "` CHARACTER SET utf8mb4"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := server.Exec("DROP DATABASE `" + name + "`"); err != nil {
			t.Error("remove isolated test database:", err)
		}
	})
	dsn.DBName = name
	db, err := gorm.Open(mysql.Open(dsn.FormatDSN()), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	pool, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = pool.Close() })
	if err := db.AutoMigrate(&model.User{}, &model.AiTask{}, &model.PointRecord{}, &model.PointRefundReceipt{}); err != nil {
		t.Fatal(err)
	}
	return db
}

func TestAdminRefundSeesCreditCommittedAfterMySQLSnapshot(t *testing.T) {
	for _, legacy := range []bool{false, true} {
		name := "with receipt"
		if legacy {
			name = "legacy without receipt"
		}
		t.Run(name, func(t *testing.T) { testAdminRefundAfterMySQLSnapshot(t, legacy) })
	}
}

func testAdminRefundAfterMySQLSnapshot(t *testing.T, legacy bool) {
	db := refundMySQLTestDB(t)
	userID, taskID := idgen.Next(), idgen.Next()
	if err := db.Create(&model.User{ID: userID, Username: "refund-snapshot", Points: 75}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.AiTask{ID: taskID, UserID: userID, PointCost: 25, Refunded: true}).Error; err != nil {
		t.Fatal(err)
	}
	reader := db.Begin(&sql.TxOptions{Isolation: sql.LevelRepeatableRead})
	if reader.Error != nil {
		t.Fatal(reader.Error)
	}
	defer reader.Rollback()
	// The admin handler reads refund evidence before obtaining the receipt lock.
	// Freeze that snapshot before another worker commits the actual refund.
	var before int64
	if err := reader.Model(&model.PointRecord{}).Count(&before).Error; err != nil {
		t.Fatal(err)
	}
	if legacy {
		// Old workers wrote the balance and ledger without a receipt.
		if err := db.Transaction(func(tx *gorm.DB) error {
			_, err := mutate(tx, userID, 25, ChangeRefund, "legacy worker", taskID)
			return err
		}); err != nil {
			t.Fatal(err)
		}
	} else {
		if credited, err := AdminRefund(db, userID, 25, "first worker", taskID); err != nil || !credited {
			t.Fatalf("first credit=%v err=%v", credited, err)
		}
	}
	credited, err := AdminRefund(reader, userID, 25, "worker with older snapshot", taskID)
	if err != nil {
		t.Fatal(err)
	}
	if err := reader.Commit().Error; err != nil {
		t.Fatal(err)
	}
	var user model.User
	if err := db.First(&user, "id = ?", userID).Error; err != nil {
		t.Fatal(err)
	}
	var refunds int64
	if err := db.Model(&model.PointRecord{}).Where("ref_id = ? AND change_type = ?", taskID, ChangeRefund).Count(&refunds).Error; err != nil {
		t.Fatal(err)
	}
	if credited || user.Points != 100 || refunds != 1 {
		t.Fatalf("stale snapshot duplicated refund: credited=%v points=%d ledger=%d", credited, user.Points, refunds)
	}
}
