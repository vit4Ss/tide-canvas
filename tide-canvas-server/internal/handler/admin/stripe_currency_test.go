package admin

import (
	"strings"
	"testing"
	"time"

	"github.com/shopspring/decimal"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"tidecanvas/internal/model"
)

func TestStripeRevenueAndOrderCurrency(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		if strings.Contains(err.Error(), "CGO_ENABLED=0") {
			t.Skip("SQLite requires CGO")
		}
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Order{}, &model.ActivationCodeClaim{}, &model.CheckinRecord{}); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	for _, order := range []model.Order{
		{OrderNo: "CNY", Currency: "CNY", Market: "cn", Amount: decimal.NewFromInt(60), Status: 1, PayTime: &now},
		{OrderNo: "USD", Currency: "USD", Market: "en", PayMethod: "stripe", Amount: decimal.NewFromInt(12), Status: 1, PayTime: &now},
		{OrderNo: "USD-refunded", Currency: "USD", Market: "en", Amount: decimal.NewFromInt(99), Status: 3, PayTime: &now},
	} {
		if err := db.Create(&order).Error; err != nil {
			t.Fatal(err)
		}
	}
	h := &dashboardHandler{db: db}
	if got := h.sumPaidAmount("", nil); got != "60.00" {
		t.Fatalf("USD mixed into CNY revenue: %s", got)
	}
	if got := h.sumPaidAmount("", nil, "USD"); got != "12.00" {
		t.Fatalf("USD revenue incorrect: %s", got)
	}
	vo := g4ToOrderVO(&model.Order{Market: "en", Currency: "USD", Amount: decimal.NewFromInt(12)}, nil)
	if vo.Currency != "USD" || vo.Market != "en" || vo.Amount != 12 {
		t.Fatal("Admin order lost original currency")
	}
	if g4ToOrderVO(&model.Order{}, nil).Currency != "CNY" {
		t.Fatal("Legacy order lost CNY default")
	}
	if g4ToPayChannelVO(&model.PayChannel{Type: "stripe"}).Currency != "USD" {
		t.Fatal("Stripe channel mislabels currency")
	}
	portrait := (&userHandler{db: db}).portraitCommerce(0)
	if portrait.PaidOrderCount != 2 || portrait.PaidAmount != "60" || portrait.PaidAmountUSD != "12" {
		t.Fatalf("Portrait mixed currencies: %+v", portrait)
	}
	for _, row := range portrait.RecentOrders {
		if row.OrderNo == "USD" && row.Currency != "USD" {
			t.Fatal("Portrait order lost USD currency")
		}
	}
}
