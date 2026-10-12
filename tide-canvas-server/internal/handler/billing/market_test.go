package billing

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/shopspring/decimal"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"tidecanvas/internal/config"
	"tidecanvas/internal/model"
	"tidecanvas/internal/pkg/idgen"
)

func marketTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		if strings.Contains(err.Error(), "CGO_ENABLED=0") {
			t.Skip("SQLite requires CGO")
		}
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Plan{}, &model.Order{}, &model.SysConfig{}, &model.PayChannel{}, &model.User{}); err != nil {
		t.Fatal(err)
	}
	return db
}

func TestBillingMarketCatalogAndPromotions(t *testing.T) {
	db := marketTestDB(t)
	plans := []model.Plan{
		{BaseModel: model.BaseModel{ID: 1001}, Name: "CN plan", Code: "pro", Price: decimal.NewFromInt(60), Features: `{"yearly":600}`, Status: 1},
		{BaseModel: model.BaseModel{ID: 1002}, Market: "en", Currency: "USD", Name: "EN plan", Code: "en_pro", Price: decimal.NewFromInt(12), Features: `{"yearly":120}`, PointsGrant: 600, Status: 1},
		{BaseModel: model.BaseModel{ID: 1003}, Market: "en", Currency: "CNY", Name: "Invalid currency", Code: "invalid", Price: decimal.NewFromInt(60), Status: 1},
	}
	for i := range plans {
		if err := db.Create(&plans[i]).Error; err != nil {
			t.Fatal(err)
		}
	}
	for _, market := range []string{"cn", "en"} {
		id := idgen.ID(1001)
		monthly := 50.0
		yearly := 500.0
		if market == "en" {
			id = 1002
			monthly = 10
			yearly = 100
		}
		if err := SavePromo(db, PromoVO{Enabled: true, Title: market, EndsAt: time.Now().Add(time.Hour).Format(time.RFC3339), Deals: []PromoDeal{{PlanID: id, Monthly: monthly, Yearly: yearly}}}, market); err != nil {
			t.Fatal(err)
		}
	}
	s := newService(db, &config.Config{})
	cn, err := s.listPlans()
	if err != nil || len(cn) != 1 || cn[0].Currency != "CNY" || cn[0].Promo.Monthly != 50 {
		t.Fatalf("CN catalog changed: %+v %v", cn, err)
	}
	en, err := s.listPlans("en")
	if err != nil || len(en) != 1 || en[0].Currency != "USD" || en[0].Market != "en" || en[0].Yearly != 120 || en[0].Promo.Yearly != 100 {
		t.Fatalf("EN catalog: %+v %v", en, err)
	}
	price, points, err := s.effectivePlanPricing(&plans[1], CycleYearly)
	if err != nil || !price.Equal(decimal.NewFromInt(100)) || points != 7200 {
		t.Fatalf("Annual USD total/credits: %s %d %v", price, points, err)
	}
}

func TestBillingMarketContentIsolation(t *testing.T) {
	db := marketTestDB(t)
	if err := SaveFaq(db, FaqVO{Items: []FaqItem{{Q: "CN", A: "Original"}}}); err != nil {
		t.Fatal(err)
	}
	en, err := LoadFaq(db, "en")
	if err != nil || len(en.Items) != 0 {
		t.Fatalf("EN inherited CN FAQ: %+v %v", en, err)
	}
	if err := SaveFaq(db, FaqVO{Items: []FaqItem{{Q: "USD", A: "Independent"}}}, "en"); err != nil {
		t.Fatal(err)
	}
	cn, _ := LoadFaq(db)
	en, _ = LoadFaq(db, "en")
	if cn.Items[0].Q != "CN" || en.Items[0].Q != "USD" {
		t.Fatal("FAQ scopes mixed")
	}
	if err := SaveCompare(db, CompareVO{Rows: []CompareRow{{Label: "EN credits", Values: map[string]string{"1002": "600"}}}}, "en"); err != nil {
		t.Fatal(err)
	}
	comparison, _ := LoadCompare(db, "en")
	if len(comparison.Rows) != 1 || comparison.Rows[0].Label != "EN credits" {
		t.Fatal("EN comparison missing")
	}
	comparison, _ = LoadCompare(db)
	if len(comparison.Rows) == 1 && comparison.Rows[0].Label == "EN credits" {
		t.Fatal("CN comparison overwritten")
	}
}

func TestBillingMarketCurrencyBoundary(t *testing.T) {
	db := marketTestDB(t)
	if err := db.Create(&model.PayChannel{Type: "alipay", Name: "Alipay", Enabled: true}).Error; err != nil {
		t.Fatal(err)
	}
	enPlan := model.Plan{BaseModel: model.BaseModel{ID: 2001}, Market: "en", Currency: "USD", Code: "en_paid", Name: "EN", Price: decimal.NewFromInt(10), Status: 1}
	if err := db.Create(&enPlan).Error; err != nil {
		t.Fatal(err)
	}
	s := newService(db, &config.Config{})
	channels, err := s.listPayChannels("en")
	if err != nil || len(channels) != 0 {
		t.Fatal("CNY payment methods leaked into USD checkout")
	}
	dto := CreateOrderDTO{Type: OrderTypePlan, PlanID: "2001", PayChannel: "alipay", Cycle: CycleMonthly}
	if _, err = s.createOrder(1, dto, "en"); !errors.Is(err, errUSDCheckoutUnavailable) {
		t.Fatalf("USD checkout must remain closed: %v", err)
	}
	if _, err = s.createOrder(1, dto); !errors.Is(err, errBadRequest) {
		t.Fatalf("CN endpoint accepted USD plan: %v", err)
	}
	var count int64
	db.Model(&model.Order{}).Count(&count)
	if count != 0 {
		t.Fatal("Rejected checkout created an order")
	}
	cnPlan := model.Plan{BaseModel: model.BaseModel{ID: 2002}, Code: "cn_paid", Name: "CN", Price: decimal.NewFromInt(60), Features: `{"yearly":600}`, Status: 1}
	if err := db.Create(&cnPlan).Error; err != nil {
		t.Fatal(err)
	}
	dto.PlanID = "2002"
	dto.Cycle = CycleYearly
	order, err := s.createOrder(1, dto)
	if err != nil || order.Amount != 600 || order.Currency != "CNY" || order.Market != "cn" {
		t.Fatalf("Legacy CNY checkout changed: %+v %v", order, err)
	}
	if _, err = s.resolveGrant(&model.Order{Currency: "USD"}); !errors.Is(err, errUSDCheckoutUnavailable) {
		t.Fatal("CNY settlement accepted a USD order")
	}
	if toOrderVO(&model.Order{}).Currency != "CNY" {
		t.Fatal("Legacy order currency changed")
	}
	if toOrderVO(&model.Order{Market: "en", Currency: "USD"}).Currency != "USD" {
		t.Fatal("USD invoice currency lost")
	}
}

func TestBillingMarketMigrationKeepsLegacyAmounts(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		if strings.Contains(err.Error(), "CGO_ENABLED=0") {
			t.Skip("SQLite requires CGO")
		}
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE TABLE plan (id integer primary key, name varchar(64), code varchar(32), price decimal(10,2))`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`INSERT INTO plan (id,name,code,price) VALUES (3001,'Existing plan','existing',60)`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Plan{}); err != nil {
		t.Fatal(err)
	}
	var plan model.Plan
	if err := db.First(&plan, "id = ?", 3001).Error; err != nil {
		t.Fatal(err)
	}
	if plan.Market != "cn" || plan.Currency != "CNY" || !plan.Price.Equal(decimal.NewFromInt(60)) {
		t.Fatalf("Legacy amount or currency changed: %+v", plan)
	}
}
